'use strict';
/**
 * backend/classroom.js — virtual classroom provider helpers (slice 3).
 *
 * WebRTC is the default provider; Agora is env-optional:
 *   VIDEO_PROVIDER=agora + AGORA_APP_ID (+ AGORA_APP_CERT for token generation).
 * No store needed — pure helpers reading env lazily.
 *
 * Agora RTC token (v006) follows the official agora-access-token construction:
 *   token = "006" + base64("006" + HMAC-SHA256(appCert, appId+channel+uid+msg)
 *           + crc32(channel) + crc32(uid) + msgLen + msg)
 *   msg   = salt + ts + privilege map (join/publish, each with an expiry ts)
 * No new dependencies: HMAC via node:crypto, CRC32 implemented below.
 */

const crypto = require('node:crypto');

const VERSION = '006';
const PRIVILEGE_JOIN_CHANNEL = 1;
const PRIVILEGE_PUBLISH_AUDIO = 2;
const PRIVILEGE_PUBLISH_VIDEO = 3;
const PRIVILEGE_PUBLISH_DATA = 4;
const ROLE_PUBLISHER = 'publisher';
const ROLE_SUBSCRIBER = 'subscriber';

/* CRC32 (IEEE 802.3, polynomial 0xEDB88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(str) {
  const buf = Buffer.from(String(str), 'utf8');
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function packUint16(x) { const b = Buffer.alloc(2); b.writeUInt16LE(x & 0xFFFF, 0); return b; }
function packUint32(x) { const b = Buffer.alloc(4); b.writeUInt32LE(x >>> 0, 0); return b; }
function packMapUint32(map) {
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  const parts = [packUint16(keys.length)];
  for (const k of keys) parts.push(packUint16(k), packUint32(map[k]));
  return Buffer.concat(parts);
}

/** Effective video provider from env. */
function providerConfig() {
  const appId = String(process.env.AGORA_APP_ID || '').trim();
  const appCertificate = String(process.env.AGORA_APP_CERT || '').trim();
  const wantAgora = String(process.env.VIDEO_PROVIDER || '').trim().toLowerCase() === 'agora';
  const agoraConfigured = Boolean(appId && appCertificate);
  return { provider: wantAgora && appId ? 'agora' : 'webrtc', agoraConfigured, appId, appCertificate };
}

/** Stable numeric Agora uid for a user id (crc32, never 0 — 0 means auto-assign). */
function uidForUser(userId) {
  const uid = crc32(String(userId || ''));
  return uid === 0 ? 1 : uid;
}

function normalizeRole(role) {
  if (role === 1 || String(role || '').toLowerCase() === 'publisher') return ROLE_PUBLISHER;
  if (role === 2 || String(role || '').toLowerCase() === 'subscriber') return ROLE_SUBSCRIBER;
  return null;
}

/**
 * Build an Agora RTC token (v006). `opts.now` (ms) and `opts.salt` exist so
 * tests can build deterministic tokens; production callers omit them.
 * Returns {token, role, expiresAt} or throws on bad input.
 */
function buildToken(appId, appCertificate, channelName, uid, role, opts = {}) {
  const channel = String(channelName || '').trim();
  const uidStr = String(uid);
  if (!appId || !appCertificate) throw new Error('Agora is not configured.');
  if (!channel || channel.length > 64 || !/^[A-Za-z0-9_\-.]+$/.test(channel)) throw new Error('Channel name must be 1 to 64 letters, digits, hyphens, underscores or dots.');
  if (!/^\d+$/.test(uidStr) || Number(uidStr) > 0xFFFFFFFF) throw new Error('uid must be a non-negative integer below 2^32.');
  const normalizedRole = normalizeRole(role === undefined ? ROLE_PUBLISHER : role);
  if (!normalizedRole) throw new Error('role must be publisher or subscriber.');
  const nowSec = Math.floor((opts.now !== undefined ? opts.now : Date.now()) / 1000);
  const salt = opts.salt !== undefined ? (opts.salt >>> 0) : crypto.randomInt(0, 0xFFFFFFFF);
  const ts = nowSec + 24 * 3600; // token validity window (v006 convention)
  const expireInSec = Math.min(Math.max(Math.floor(Number(opts.expireInSec) || 3600), 60), 24 * 3600);
  const expireTs = nowSec + expireInSec;
  const privileges = { [PRIVILEGE_JOIN_CHANNEL]: expireTs };
  if (normalizedRole === ROLE_PUBLISHER) {
    privileges[PRIVILEGE_PUBLISH_AUDIO] = expireTs;
    privileges[PRIVILEGE_PUBLISH_VIDEO] = expireTs;
    privileges[PRIVILEGE_PUBLISH_DATA] = expireTs;
  }
  const msg = Buffer.concat([packUint32(salt), packUint32(ts), packMapUint32(privileges)]);
  const signature = crypto.createHmac('sha256', appCertificate)
    .update(Buffer.concat([Buffer.from(appId, 'utf8'), Buffer.from(channel, 'utf8'), Buffer.from(uidStr, 'utf8'), msg]))
    .digest();
  const content = Buffer.concat([
    Buffer.from(VERSION, 'utf8'), signature,
    packUint32(crc32(channel)), packUint32(crc32(uidStr)),
    packUint16(msg.length), msg,
  ]);
  return { token: VERSION + content.toString('base64'), role: normalizedRole, expiresAt: new Date(expireTs * 1000).toISOString() };
}

/**
 * Verify an Agora v006 token against the app id / certificate / channel / uid
 * it was built for. Returns {ok:true, salt, ts, privileges} or {ok:false, error}.
 */
function verifyToken(token, appId, appCertificate, channelName, uid) {
  if (typeof token !== 'string' || !token.startsWith(VERSION)) return { ok: false, error: 'Not an Agora v006 token.' };
  let content;
  try { content = Buffer.from(token.slice(VERSION.length), 'base64'); } catch { return { ok: false, error: 'Bad base64.' }; }
  if (content.length < 45 || content.subarray(0, 3).toString('utf8') !== VERSION) return { ok: false, error: 'Malformed token.' };
  const signature = content.subarray(3, 35);
  const crcChannel = content.readUInt32LE(35);
  const crcUid = content.readUInt32LE(39);
  const msgLen = content.readUInt16LE(43);
  if (content.length < 45 + msgLen) return { ok: false, error: 'Truncated token.' };
  const msg = content.subarray(45, 45 + msgLen);
  const channel = String(channelName || '');
  const uidStr = String(uid);
  if (crc32(channel) !== crcChannel || crc32(uidStr) !== crcUid) return { ok: false, error: 'Channel or uid does not match this token.' };
  const expected = crypto.createHmac('sha256', appCertificate)
    .update(Buffer.concat([Buffer.from(appId, 'utf8'), Buffer.from(channel, 'utf8'), Buffer.from(uidStr, 'utf8'), msg]))
    .digest();
  if (!crypto.timingSafeEqual(signature, expected)) return { ok: false, error: 'Signature mismatch.' };
  const salt = msg.readUInt32LE(0);
  const ts = msg.readUInt32LE(4);
  const count = msg.readUInt16LE(8);
  if (msg.length !== 10 + count * 6) return { ok: false, error: 'Malformed privilege map.' };
  const privileges = {};
  for (let i = 0; i < count; i++) {
    privileges[msg.readUInt16LE(10 + i * 6)] = msg.readUInt32LE(12 + i * 6);
  }
  return { ok: true, salt, ts, privileges };
}

module.exports = {
  crc32, providerConfig, uidForUser, normalizeRole, buildToken, verifyToken,
  VERSION, PRIVILEGE_JOIN_CHANNEL, PRIVILEGE_PUBLISH_AUDIO, PRIVILEGE_PUBLISH_VIDEO, PRIVILEGE_PUBLISH_DATA,
};
