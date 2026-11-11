'use strict';
/**
 * backend/jwt.js — JWT auth (HS256, no new deps) + opaque refresh tokens.
 *   - Access token: HS256 JWT, 1h, iss 'eduverse', aud 'eduverse-api'.
 *     Payload: {sub, username, role, institutionId, iat, exp}.
 *   - Refresh token: opaque random string, 7d, stored SHA-256-hashed in
 *     store.refreshTokens[] {id, userId, hash, createdAt, expiresAt, revoked}.
 *     Rotation on every refresh (old token is revoked and can never be reused).
 *   - Secret: JWT_SECRET env. Without it, a random per-process secret is used
 *     and a warning is logged (tokens do not survive a restart in that case).
 * Holds a reference to the store (injected via init, same pattern as
 * org/sec/live/family/library/career/lang/standards). No circular require:
 * server.js requires this file; this file requires nothing from server.js.
 */
const { randomUUID, randomBytes, createHmac, timingSafeEqual, createHash } = require('node:crypto');

let store = null;
function init(s) { store = s; }

const ISS = 'eduverse';
const AUD = 'eduverse-api';
const ACCESS_TTL_SEC = 3600;          // 1 hour
const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

let fallbackSecret = null;
function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    console.warn('[eduverse] JWT_SECRET is not set — using a random per-process secret. Set JWT_SECRET for tokens that survive restarts.');
  }
  return fallbackSecret;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64uDec = (s) => Buffer.from(String(s || ''), 'base64url');
function b64uDecCanonical(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid base64url segment.');
  const decoded = b64uDec(s);
  if (b64u(decoded) !== s) throw new Error('Non-canonical base64url segment.');
  return decoded;
}

/** Sign a payload. `expiresInSec` is seconds from now. */
function sign(payload, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISS, aud: AUD, iat: now, exp: now + expiresInSec, ...payload };
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = header + '.' + b64u(JSON.stringify(body));
  const sig = b64u(createHmac('sha256', secret()).update(data).digest());
  return data + '.' + sig;
}

/** Verify a JWT. Returns {ok:true, payload} or {ok:false, error}. Never throws. */
function verify(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, error: 'Malformed token.' };
    const [h, p, s] = parts;
    const header = JSON.parse(b64uDecCanonical(h).toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return { ok: false, error: 'Invalid token header.' };
    const payload = JSON.parse(b64uDecCanonical(p).toString('utf8'));
    const expected = createHmac('sha256', secret()).update(h + '.' + p).digest();
    const actual = b64uDecCanonical(s);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: 'Invalid signature.' };
    }
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= now) return { ok: false, error: 'Token expired or missing expiry.' };
    if (payload.iss !== ISS || payload.aud !== AUD) return { ok: false, error: 'Invalid issuer/audience.' };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'Malformed token.' };
  }
}

/* ------------------------------------------------------------------ */
/* Refresh tokens (opaque, hashed at rest, rotating)                  */
/* ------------------------------------------------------------------ */

function hashRefresh(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

/** Drop refresh records that expired more than a day ago (housekeeping). */
function pruneRefresh() {
  if (!store || !Array.isArray(store.refreshTokens)) return;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  store.refreshTokens = store.refreshTokens.filter((r) => new Date(r.expiresAt).getTime() > cutoff);
}

function issueAccessToken(user) {
  return sign(
    { sub: user.id, username: user.username || '', role: user.role, institutionId: user.institutionId || null },
    ACCESS_TTL_SEC
  );
}

function issueRefreshToken(userId) {
  pruneRefresh();
  const raw = randomBytes(32).toString('base64url');
  store.refreshTokens ||= [];
  store.refreshTokens.push({
    id: randomUUID(),
    userId,
    hash: hashRefresh(raw),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    revoked: false,
  });
  return raw;
}

/** Issue a fresh access + refresh pair for a user. */
function issueTokenPair(user) {
  return {
    accessToken: issueAccessToken(user),
    refreshToken: issueRefreshToken(user.id),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_SEC,
  };
}

function findRefresh(raw) {
  if (!raw || !store || !Array.isArray(store.refreshTokens)) return null;
  const h = hashRefresh(raw);
  return store.refreshTokens.find((r) => r.hash === h) || null;
}

/**
 * Rotate a refresh token: validates it, revokes it, and issues a new pair.
 * Returns {ok:true, user, pair} or {ok:false, error}.
 */
function rotateRefresh(raw) {
  const rec = findRefresh(raw);
  if (!rec) return { ok: false, error: 'Refresh token is invalid.' };
  if (rec.revoked) return { ok: false, error: 'Refresh token has been revoked.' };
  if (new Date(rec.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'Refresh token expired.' };
  const user = (store.users || []).find((u) => u.id === rec.userId && u.status === 'active');
  if (!user) return { ok: false, error: 'Account is not active.' };
  rec.revoked = true; // rotation: the presented token can never be used again
  return { ok: true, user, pair: issueTokenPair(user) };
}

/** Revoke one refresh token. Returns true if a record was found. */
function revokeRefresh(raw) {
  const rec = findRefresh(raw);
  if (rec) rec.revoked = true;
  return !!rec;
}

/** Revoke every refresh token belonging to a user. Returns the count revoked. */
function revokeAllForUser(userId) {
  let n = 0;
  for (const r of store.refreshTokens || []) {
    if (r.userId === userId && !r.revoked) { r.revoked = true; n++; }
  }
  return n;
}

module.exports = {
  init, sign, verify, issueAccessToken, issueRefreshToken, issueTokenPair,
  rotateRefresh, revokeRefresh, revokeAllForUser, hashRefresh,
  ACCESS_TTL_SEC, REFRESH_TTL_MS,
};
