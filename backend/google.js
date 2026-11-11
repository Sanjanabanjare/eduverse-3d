'use strict';
/**
 * backend/google.js — Google OAuth 2.0 login (env-optional).
 *   Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *        GOOGLE_REDIRECT_URI (default http://127.0.0.1:4173/api/auth/google/callback).
 * Pure helpers + an injectable fetch (setFetch) so the verify helpers can be
 * unit-tested without hitting Google. server.js does the find-or-create user
 * logic; this file only talks to Google. No circular require.
 */
let fetchImpl = null;
function setFetch(fn) { fetchImpl = fn; }
function httpFetch(...args) { return (fetchImpl || globalThis.fetch)(...args); }

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:4173/api/auth/google/callback';
}

function buildAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}

/** Exchange an authorization code for tokens (server-side). Throws on failure. */
async function exchangeCode(code) {
  const res = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google token exchange failed (' + res.status + ').');
  if (!data.access_token) throw new Error('Google did not return an access token.');
  return data;
}

/** Fetch the Google profile for an access token. Throws on failure. */
async function getUserInfo(accessToken) {
  const res = await httpFetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google userinfo failed (' + res.status + ').');
  return normalizeProfile(data);
}

/**
 * Verify a Google ID token via tokeninfo. Checks audience, expiry and that
 * the email is verified. Returns the normalized profile. Throws on failure.
 */
async function verifyIdToken(idToken) {
  const res = await httpFetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google token verification failed (' + res.status + ').');
  if (data.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Google token audience mismatch.');
  if (Number(data.exp) * 1000 <= Date.now()) throw new Error('Google token expired.');
  if (data.email_verified !== 'true' && data.email_verified !== true) {
    throw new Error('Google email is not verified.');
  }
  return normalizeProfile({ id: data.sub, email: data.email, name: data.name, verified_email: true });
}

/** Normalize the various Google profile shapes to one shape. */
function normalizeProfile(p) {
  return {
    googleId: String(p.id || p.sub || ''),
    email: String(p.email || '').toLowerCase(),
    name: String(p.name || '').trim(),
    emailVerified: p.verified_email === true || p.verified_email === 'true',
  };
}

module.exports = {
  configured, redirectUri, buildAuthUrl, exchangeCode, getUserInfo,
  verifyIdToken, normalizeProfile, setFetch,
};
