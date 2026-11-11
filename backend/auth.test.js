'use strict';
/* Auth slice backend tests: JWT access/refresh, Bearer auth + role gates,
 * email verification + password reset returning tokens, Google (unconfigured
 * HTTP paths + verify helper with stubbed fetch). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const JWT_SECRET = 'auth-test-secret';
process.env.JWT_SECRET = JWT_SECRET;
const jwt = require('./jwt');
const google = require('./google');

let baseUrl, port, serverProcess, tempDir, storePath;
let superCookie, teacherCookie, studentCookie, studentId, teacherId;
let studentAccess, studentRefresh;

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const { port: p } = s.address();
  await new Promise(res => s.close(res));
  return p;
}
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error('server exited early');
    try { const r = await fetch(`${baseUrl}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}
function req(url, options, auth) {
  const headers = { ...(options?.headers || {}) };
  if (auth?.cookie) headers.Cookie = auth.cookie;
  if (auth?.bearer) headers.Authorization = 'Bearer ' + auth.bearer;
  return fetch(`${baseUrl}${url}`, { ...options, headers });
}
function jsonReq(url, options, auth) {
  return req(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } }, auth);
}
async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { throw new Error(`Non-JSON (${res.status}): ${t.slice(0, 300)}`); }
}
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-auth-'));
  storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', JWT_SECRET },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForServer();

  let r = await jsonReq('/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'super login');
  superCookie = cookieOf(r);

  r = await jsonReq('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Tia Teacher', email: 'tia@example.com', password: 'Password123456', role: 'teacher' }) }, { cookie: superCookie });
  await assertStatus(r, 201, 'create teacher');
  teacherId = (await json(r)).user.id;
  r = await jsonReq('/api/admin/users/' + teacherId, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, { cookie: superCookie });
  await assertStatus(r, 200, 'approve teacher');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  r = await jsonReq('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Stu Dent', username: 'stux', password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup');
  const created = await json(r);
  studentId = created.user.id;
  assert.ok(created.accessToken, 'signup returns an access token');
  assert.ok(created.refreshToken, 'signup returns a refresh token');
  assert.equal(created.tokenType, 'Bearer');
  assert.equal(created.expiresIn, 3600);
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login');
  const logged = await json(r);
  assert.ok(logged.accessToken && logged.refreshToken, 'login returns a JWT pair');
  studentAccess = logged.accessToken;
  studentRefresh = logged.refreshToken;
  studentCookie = cookieOf(r);
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill('SIGTERM');
});

/* ---------------- jwt.js unit checks ---------------- */

test('jwt sign/verify round-trip, tamper and expiry rejected', () => {
  const token = jwt.sign({ sub: 'u1', username: 'a', role: 'student', institutionId: null }, 3600);
  const v = jwt.verify(token);
  assert.equal(v.ok, true);
  assert.equal(v.payload.sub, 'u1');
  assert.equal(v.payload.iss, 'eduverse');
  assert.equal(v.payload.aud, 'eduverse-api');
  // Tampered signature
  const parts = token.split('.');
  const bad = parts[0] + '.' + parts[1] + '.' + parts[2].replace(/.$/, parts[2].endsWith('A') ? 'B' : 'A');
  assert.equal(jwt.verify(bad).ok, false);
  // Expired
  assert.equal(jwt.verify(jwt.sign({ sub: 'u1' }, -10)).ok, false);
  // Wrong issuer
  assert.equal(jwt.verify(jwt.sign({ sub: 'u1', iss: 'other' }, 3600)).ok, false);
  // Malformed
  assert.equal(jwt.verify('not-a-token').ok, false);
  assert.equal(jwt.verify('').ok, false);
});

/* ---------------- Google helper unit checks (stubbed fetch) ---------------- */

test('google verifyIdToken validates audience, expiry and verified email', async () => {
  const prevId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  const okBody = { aud: 'test-client-id', exp: String(Math.floor(Date.now() / 1000) + 3600), email_verified: 'true', sub: 'g123', email: 'g@example.com', name: 'G User' };
  google.setFetch(async () => ({ ok: true, json: async () => ({ ...okBody }) }));
  try {
    const p = await google.verifyIdToken('tok');
    assert.equal(p.googleId, 'g123');
    assert.equal(p.email, 'g@example.com');
    assert.equal(p.emailVerified, true);
    // Audience mismatch
    google.setFetch(async () => ({ ok: true, json: async () => ({ ...okBody, aud: 'someone-else' }) }));
    await assert.rejects(() => google.verifyIdToken('tok'), /audience/);
    // Expired
    google.setFetch(async () => ({ ok: true, json: async () => ({ ...okBody, exp: String(Math.floor(Date.now() / 1000) - 10) }) }));
    await assert.rejects(() => google.verifyIdToken('tok'), /expired/);
    // Unverified email
    google.setFetch(async () => ({ ok: true, json: async () => ({ ...okBody, email_verified: 'false' }) }));
    await assert.rejects(() => google.verifyIdToken('tok'), /not verified/);
    // Auth URL carries client id + state
    const url = google.buildAuthUrl('state123');
    assert.ok(url.includes('client_id=test-client-id') && url.includes('state=state123'));
  } finally {
    google.setFetch(null);
    if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevId;
  }
});

/* ---------------- Bearer auth + /api/auth/me ---------------- */

test('Bearer token authenticates /api/auth/me; bad/expired tokens 401', async () => {
  let r = await req('/api/auth/me', {}, { bearer: studentAccess });
  await assertStatus(r, 200, 'me with Bearer');
  assert.equal((await json(r)).user.username, 'stux');
  r = await req('/api/auth/me', {}, {});
  await assertStatus(r, 401, 'me without auth');
  const parts = studentAccess.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' + parts[2].replace(/.$/, parts[2].endsWith('A') ? 'B' : 'A');
  r = await req('/api/auth/me', {}, { bearer: tampered });
  await assertStatus(r, 401, 'me with tampered token');
  const expired = jwt.sign({ sub: studentId, username: 'stux', role: 'student', institutionId: null }, -10);
  r = await req('/api/auth/me', {}, { bearer: expired });
  await assertStatus(r, 401, 'me with expired token');
  // Unknown user id in a well-formed token
  const ghost = jwt.sign({ sub: 'no-such-user', username: 'ghost', role: 'student', institutionId: null }, 3600);
  r = await req('/api/auth/me', {}, { bearer: ghost });
  await assertStatus(r, 401, 'me with unknown sub');
});

test('JWT verifier rejects non-canonical base64url aliases', async () => {
  const parts = studentAccess.split('.');
  const signature = parts[2];
  const expectedBytes = Buffer.from(signature, 'base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const alias = [...alphabet].find(char => char !== signature.at(-1) && Buffer.from(signature.slice(0, -1) + char, 'base64url').equals(expectedBytes));
  assert.ok(alias, 'test signature has a non-canonical base64url alias');
  const response = await req('/api/auth/me', {}, { bearer: `${parts[0]}.${parts[1]}.${signature.slice(0, -1)}${alias}` });
  await assertStatus(response, 401, 'me with non-canonical signature');
});

/* ---------------- Role gates work identically for Bearer tokens ---------------- */

test('role gates enforced for Bearer tokens', async () => {
  let r = await req('/api/admin/users', {}, { bearer: studentAccess });
  await assertStatus(r, 403, 'student Bearer blocked from admin users');
  r = await jsonReq('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Nope', description: 'x' }) }, { bearer: studentAccess });
  await assertStatus(r, 403, 'student Bearer blocked from teacher course creation');
  // Teacher Bearer works on a teacher endpoint
  const tr = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tia@example.com', password: 'Password123456' }) });
  const teacherPair = await json(tr);
  r = await jsonReq('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Bearer Course', description: 'made with a JWT' }) }, { bearer: teacherPair.accessToken });
  await assertStatus(r, 201, 'teacher Bearer can create a course');
});

/* ---------------- Refresh rotation + logout revocation ---------------- */

test('refresh rotates and the old refresh token is rejected; logout revokes', async () => {
  // Fresh login so this test owns its refresh token
  let r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'Password123456' }) });
  const pair = await json(r);
  r = await jsonReq('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: pair.refreshToken }) });
  await assertStatus(r, 200, 'refresh works');
  const rotated = await json(r);
  assert.ok(rotated.accessToken && rotated.refreshToken, 'refresh returns a new pair');
  assert.notEqual(rotated.refreshToken, pair.refreshToken, 'refresh token rotated');
  // Old refresh token is now dead (rotation)
  r = await jsonReq('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: pair.refreshToken }) });
  await assertStatus(r, 401, 'rotated-out refresh token rejected');
  // Invalid refresh token
  r = await jsonReq('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: 'bogus' }) });
  await assertStatus(r, 401, 'bogus refresh token rejected');
  // Logout with the current refresh token revokes it
  r = await jsonReq('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rotated.refreshToken }) }, { cookie: cookieOf(await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'Password123456' }) })) });
  await assertStatus(r, 200, 'logout ok');
  r = await jsonReq('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rotated.refreshToken }) });
  await assertStatus(r, 401, 'refresh token revoked by logout');
});

/* ---------------- /api/auth/token + profile over Bearer ---------------- */

test('POST /api/auth/token issues a pair; profile reads/writes work over Bearer', async () => {
  let r = await jsonReq('/api/auth/token', { method: 'POST', body: JSON.stringify({}) }, { cookie: studentCookie });
  await assertStatus(r, 200, 'token via session cookie');
  const pair = await json(r);
  assert.ok(pair.accessToken && pair.refreshToken);
  r = await req('/api/profile', {}, { bearer: studentAccess });
  await assertStatus(r, 200, 'GET profile with Bearer');
  assert.equal((await json(r)).profile.username, 'stux');
  r = await jsonReq('/api/profile', { method: 'PATCH', body: JSON.stringify({ email: 'stu@example.com' }) }, { bearer: studentAccess });
  await assertStatus(r, 200, 'PATCH profile with Bearer');
  assert.equal((await json(r)).profile.email, 'stu@example.com');
});

/* ---------------- Email verification flow ---------------- */

test('email verification: send, verify with token from outbox, tokens returned', async () => {
  let r = await jsonReq('/api/auth/send-verification', { method: 'POST', body: JSON.stringify({}) }, { bearer: studentAccess });
  await assertStatus(r, 200, 'send-verification');
  const raw = await fs.readFile(storePath, 'utf8');
  const store = JSON.parse(raw);
  const mail = (store.emailOutbox || []).filter(m => m.to === 'stu@example.com').pop();
  assert.ok(mail, 'verification email landed in dev outbox');
  const m = String(mail.html || '').match(/token=([0-9a-f]{64})/);
  assert.ok(m, 'outbox link carries a token');
  // Bad token rejected
  r = await jsonReq('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: '0'.repeat(64) }) });
  await assertStatus(r, 400, 'bad verification token');
  // Good token verifies and logs in with JWTs
  r = await jsonReq('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: m[1] }) });
  await assertStatus(r, 200, 'verify-email');
  const done = await json(r);
  assert.equal(done.user.emailVerified, true);
  assert.ok(done.accessToken && done.refreshToken, 'verify-email returns a JWT pair');
  // Token is single-use
  r = await jsonReq('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: m[1] }) });
  await assertStatus(r, 400, 'verification token is single-use');
});

/* ---------------- Password reset returns tokens ---------------- */

test('password reset via admin recovery code returns a JWT pair', async () => {
  let r = await jsonReq('/api/admin/users/' + studentId + '/recovery', { method: 'POST', body: JSON.stringify({}) }, { cookie: superCookie });
  await assertStatus(r, 201, 'admin issues recovery code');
  const recoveryToken = (await json(r)).recoveryToken;
  assert.ok(recoveryToken, 'recovery token issued');
  r = await jsonReq('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: recoveryToken, password: 'NewPassword123456' }) });
  await assertStatus(r, 200, 'reset-password');
  const done = await json(r);
  assert.ok(done.accessToken && done.refreshToken, 'reset-password returns a JWT pair');
  assert.equal(done.user.username, 'stux');
  // New password works; old refresh token from before the reset is revoked
  r = await jsonReq('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: studentRefresh }) });
  await assertStatus(r, 401, 'pre-reset refresh token revoked by password reset');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'NewPassword123456' }) });
  await assertStatus(r, 200, 'login with new password');
});

/* ---------------- Google: unconfigured paths ---------------- */

test('Google login is 501 + clear message when unconfigured', async () => {
  let r = await req('/api/auth/google/status', {}, {});
  await assertStatus(r, 200, 'google status');
  assert.equal((await json(r)).configured, false);
  r = await req('/api/auth/google', {}, {});
  await assertStatus(r, 501, 'google launch 501');
  assert.match((await json(r)).error, /not configured/);
  r = await jsonReq('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'x' }) });
  await assertStatus(r, 501, 'google idToken 501');
});
