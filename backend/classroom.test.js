'use strict';
/* Slice 3 backend tests: Agora token generation/verification, video-provider
 * setting, live-session attendance report, upcoming sessions. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const classroom = require('./classroom');

const AGORA_APP_ID = 'test-agora-app-id-12345';
const AGORA_APP_CERT = 'test-agora-app-cert-abcdef0123456789';
const CHANNEL = 'class-101';
const UID = 123456;
const FIXED_NOW = 1780000000000; // fixed ms epoch for deterministic tokens

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, teacher2Cookie, studentCookie;
let agoraUrl, agoraPort, agoraProcess, agoraTempDir, agoraCookie;
let soonSessionId, laterSessionId, otherSessionId;

async function freePort() {
  const s = net.createServer();
  await new Promise((res, rej) => s.once('error', rej).listen(0, '127.0.0.1', res));
  const { port: p } = s.address();
  await new Promise(res => s.close(res));
  return p;
}
async function waitForServer(url, proc) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error('server exited early');
    try { const r = await fetch(`${url}/api/health`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}
function spawnServer(storePath, p, extraEnv) {
  return spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(p), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', ...(extraEnv || {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}
async function req(base, url, options, cookie) {
  return fetch(`${base}${url}`, { ...options, headers: { ...(options?.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
}
async function jsonReq(base, url, options, cookie) {
  return req(base, url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } }, cookie);
}
async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { throw new Error(`Non-JSON (${res.status}): ${t.slice(0, 300)}`); }
}
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
}
async function createApprovedTeacher(base, superCk, name, email) {
  let r = await jsonReq(base, '/api/admin/users', { method: 'POST', body: JSON.stringify({ name, email, password: 'Password123456', role: 'teacher' }) }, superCk);
  await assertStatus(r, 201, 'create teacher ' + email);
  const teacherId = (await json(r)).user.id;
  r = await jsonReq(base, '/api/admin/users/' + teacherId, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCk);
  await assertStatus(r, 200, 'approve teacher ' + email);
  r = await jsonReq(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login ' + email);
  return cookieOf(r);
}
async function createSession(base, cookie, title, startsInMin) {
  const r = await jsonReq(base, '/api/teacher/live-sessions', { method: 'POST', body: JSON.stringify({
    title, startsAt: new Date(Date.now() + startsInMin * 60000).toISOString(),
    durationMin: 60, meetingUrl: 'https://meet.example.com/room-' + title.replace(/\s+/g, '-').toLowerCase(),
  }) }, cookie);
  await assertStatus(r, 201, 'create live session ' + title);
  return (await json(r)).session.id;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-classroom-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawnServer(storePath, port);
  await waitForServer(baseUrl, serverProcess);

  let r = await jsonReq(baseUrl, '/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  r = await jsonReq(baseUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'super login');
  superCookie = cookieOf(r);

  teacherCookie = await createApprovedTeacher(baseUrl, superCookie, 'Tia Teacher', 'tia@example.com');
  teacher2Cookie = await createApprovedTeacher(baseUrl, superCookie, 'Tom Teacher', 'tom@example.com');

  r = await jsonReq(baseUrl, '/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Stu Dent', username: 'stux', password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup');
  r = await jsonReq(baseUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login');
  studentCookie = cookieOf(r);

  soonSessionId = await createSession(baseUrl, teacherCookie, 'Soon Session', 30);
  laterSessionId = await createSession(baseUrl, teacherCookie, 'Later Session', 120);
  otherSessionId = await createSession(baseUrl, teacher2Cookie, 'Other Teacher Session', 30);
});

test.after(async () => {
  if (serverProcess) { serverProcess.kill(); await new Promise(r => serverProcess.once('exit', r)); }
  if (agoraProcess) { agoraProcess.kill(); await new Promise(r => agoraProcess.once('exit', r)); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  if (agoraTempDir) await fs.rm(agoraTempDir, { recursive: true, force: true });
});

/* ---- Unit: CRC32 + token build/verify ---- */

test('crc32 matches the standard check value', () => {
  assert.equal(classroom.crc32('123456789'), 0xCBF43926);
  assert.equal(classroom.crc32(''), 0);
});

test('buildToken is deterministic with fixed salt/now and verifies', () => {
  const a = classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'publisher', { now: FIXED_NOW, salt: 42 });
  const b = classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'publisher', { now: FIXED_NOW, salt: 42 });
  assert.equal(a.token, b.token, 'same inputs must build the same token');
  assert.ok(a.token.startsWith('006'));
  assert.equal(a.role, 'publisher');
  const c = classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'publisher', { now: FIXED_NOW, salt: 43 });
  assert.notEqual(a.token, c.token, 'different salt must change the token');
  const v = classroom.verifyToken(a.token, AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID);
  assert.equal(v.ok, true, 'verify must pass: ' + (v.error || ''));
  assert.equal(v.salt, 42);
  assert.equal(v.ts, Math.floor(FIXED_NOW / 1000) + 24 * 3600);
  // Publisher gets join + publish audio/video/data privileges.
  assert.deepEqual(Object.keys(v.privileges).map(Number).sort((x, y) => x - y), [1, 2, 3, 4]);
  const sub = classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'subscriber', { now: FIXED_NOW, salt: 7 });
  const vs = classroom.verifyToken(sub.token, AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID);
  assert.equal(vs.ok, true);
  assert.deepEqual(Object.keys(vs.privileges).map(Number), [1], 'subscriber gets join only');
});

test('verifyToken rejects wrong channel, wrong cert and tampered tokens', () => {
  const built = classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'publisher', { now: FIXED_NOW, salt: 99 });
  assert.equal(classroom.verifyToken(built.token, AGORA_APP_ID, AGORA_APP_CERT, 'other-channel', UID).ok, false);
  assert.equal(classroom.verifyToken(built.token, AGORA_APP_ID, 'wrong-cert', CHANNEL, UID).ok, false);
  assert.equal(classroom.verifyToken(built.token, AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, 999).ok, false);
  // Flip a base64 data character inside the signature region (not the '=' padding,
  // which carries no bits and would decode to the same bytes).
  const tampered = built.token.slice(0, 10) + (built.token[10] === 'A' ? 'B' : 'A') + built.token.slice(11);
  assert.equal(classroom.verifyToken(tampered, AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID).ok, false);
  assert.equal(classroom.verifyToken('not-a-token', AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID).ok, false);
  assert.throws(() => classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, '', UID, 'publisher'), /Channel name/);
  assert.throws(() => classroom.buildToken(AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, UID, 'host'), /role must be/);
});

test('providerConfig follows env; uidForUser is stable and non-zero', () => {
  const saved = { vp: process.env.VIDEO_PROVIDER, id: process.env.AGORA_APP_ID, cert: process.env.AGORA_APP_CERT };
  try {
    delete process.env.VIDEO_PROVIDER; delete process.env.AGORA_APP_ID; delete process.env.AGORA_APP_CERT;
    assert.deepEqual(classroom.providerConfig(), { provider: 'webrtc', agoraConfigured: false, appId: '', appCertificate: '' });
    process.env.VIDEO_PROVIDER = 'agora';
    process.env.AGORA_APP_ID = AGORA_APP_ID;
    process.env.AGORA_APP_CERT = AGORA_APP_CERT;
    const cfg = classroom.providerConfig();
    assert.equal(cfg.provider, 'agora');
    assert.equal(cfg.agoraConfigured, true);
    process.env.VIDEO_PROVIDER = 'webrtc';
    assert.equal(classroom.providerConfig().provider, 'webrtc');
  } finally {
    if (saved.vp === undefined) delete process.env.VIDEO_PROVIDER; else process.env.VIDEO_PROVIDER = saved.vp;
    if (saved.id === undefined) delete process.env.AGORA_APP_ID; else process.env.AGORA_APP_ID = saved.id;
    if (saved.cert === undefined) delete process.env.AGORA_APP_CERT; else process.env.AGORA_APP_CERT = saved.cert;
  }
  const uid = classroom.uidForUser('some-user-id');
  assert.equal(uid, classroom.uidForUser('some-user-id'));
  assert.ok(Number.isInteger(uid) && uid > 0 && uid <= 0xFFFFFFFF);
});

/* ---- Server: provider setting + token 501 when unconfigured ---- */

test('video-provider setting reports webrtc when Agora is unconfigured', async () => {
  const r = await req(baseUrl, '/api/settings/video-provider', {}, studentCookie);
  await assertStatus(r, 200, 'provider setting');
  assert.deepEqual(await json(r), { provider: 'webrtc', agoraConfigured: false });
  const unauth = await req(baseUrl, '/api/settings/video-provider', {});
  assert.equal(unauth.status, 401);
});

test('token endpoint returns 501 when Agora is unconfigured', async () => {
  const r = await jsonReq(baseUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: 'class-101', role: 'publisher' }) }, studentCookie);
  assert.equal(r.status, 501);
  assert.match((await json(r)).error, /not configured/);
});

/* ---- Server: attendance report ---- */

test('attendance report: owner sees joins, other teacher gets 404, admin allowed', async () => {
  let r = await jsonReq(baseUrl, `/api/live-sessions/${soonSessionId}/join`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'student join');
  r = await req(baseUrl, `/api/teacher/live-sessions/${soonSessionId}/attendance`, {}, teacherCookie);
  await assertStatus(r, 200, 'owner attendance');
  const body = await json(r);
  assert.equal(body.present, 1);
  assert.equal(body.total, 1, 'open session: total is the joiner count');
  assert.equal(body.attendees.length, 1);
  assert.equal(body.attendees[0].name, 'Stu Dent');
  assert.ok(body.attendees[0].joinedAt);
  assert.equal(body.session.id, soonSessionId);
  r = await req(baseUrl, `/api/teacher/live-sessions/${soonSessionId}/attendance`, {}, teacher2Cookie);
  assert.equal(r.status, 404, 'other teacher must not see the report');
  r = await req(baseUrl, `/api/teacher/live-sessions/${soonSessionId}/attendance`, {}, superCookie);
  await assertStatus(r, 200, 'admin attendance');
  r = await req(baseUrl, `/api/teacher/live-sessions/${laterSessionId}/attendance`, {}, teacherCookie);
  await assertStatus(r, 200, 'empty attendance');
  const emptyBody = await json(r);
  assert.deepEqual({ present: emptyBody.present, total: emptyBody.total }, { present: 0, total: 0 });
  r = await req(baseUrl, '/api/teacher/live-sessions/does-not-exist/attendance', {}, teacherCookie);
  assert.equal(r.status, 404);
});

/* ---- Server: upcoming sessions ---- */

test('upcoming lists sessions starting within 60 minutes, scoped per role', async () => {
  let r = await req(baseUrl, '/api/live-sessions/upcoming', {}, teacherCookie);
  await assertStatus(r, 200, 'teacher upcoming');
  let ids = (await json(r)).sessions.map(s => s.id);
  assert.ok(ids.includes(soonSessionId), '30-min session must appear');
  assert.ok(!ids.includes(laterSessionId), '2-hour session must not appear');
  assert.ok(!ids.includes(otherSessionId), 'another teacher session must not appear for this teacher');

  r = await req(baseUrl, '/api/live-sessions/upcoming', {}, studentCookie);
  await assertStatus(r, 200, 'student upcoming');
  ids = (await json(r)).sessions.map(s => s.id);
  assert.ok(ids.includes(soonSessionId), 'open 30-min session must appear for students');
  assert.ok(ids.includes(otherSessionId), 'open session from another teacher is visible to students');
  assert.ok(!ids.includes(laterSessionId));

  r = await req(baseUrl, '/api/live-sessions/upcoming', {}, teacher2Cookie);
  ids = (await json(r)).sessions.map(s => s.id);
  assert.ok(ids.includes(otherSessionId));
  assert.ok(!ids.includes(soonSessionId));

  const unauth = await req(baseUrl, '/api/live-sessions/upcoming', {});
  assert.equal(unauth.status, 401);
});

/* ---- Server with Agora configured: token endpoint works ---- */

test('token endpoint mints verifiable Agora tokens when configured', async () => {
  agoraTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-classroom-agora-'));
  const storePath = path.join(agoraTempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  agoraPort = await freePort();
  agoraUrl = `http://127.0.0.1:${agoraPort}`;
  agoraProcess = spawnServer(storePath, agoraPort, { VIDEO_PROVIDER: 'agora', AGORA_APP_ID, AGORA_APP_CERT });
  await waitForServer(agoraUrl, agoraProcess);

  let r = await jsonReq(agoraUrl, '/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'agora setup-admin');
  r = await jsonReq(agoraUrl, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'agora super login');
  agoraCookie = cookieOf(r);

  r = await req(agoraUrl, '/api/settings/video-provider', {}, agoraCookie);
  await assertStatus(r, 200, 'agora provider setting');
  assert.deepEqual(await json(r), { provider: 'agora', agoraConfigured: true });

  r = await jsonReq(agoraUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: CHANNEL, role: 'publisher' }) }, agoraCookie);
  await assertStatus(r, 200, 'mint publisher token');
  const body = await json(r);
  assert.ok(body.token.startsWith('006'));
  assert.equal(body.appId, AGORA_APP_ID);
  assert.equal(body.channel, CHANNEL);
  assert.equal(body.role, 'publisher');
  assert.ok(Number.isInteger(body.uid) && body.uid > 0);
  assert.ok(body.expiresAt);
  const v = classroom.verifyToken(body.token, AGORA_APP_ID, AGORA_APP_CERT, CHANNEL, body.uid);
  assert.equal(v.ok, true, 'minted token must verify: ' + (v.error || ''));
  assert.deepEqual(Object.keys(v.privileges).map(Number).sort((a, b) => a - b), [1, 2, 3, 4]);

  r = await jsonReq(agoraUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: CHANNEL, role: 'subscriber' }) }, agoraCookie);
  await assertStatus(r, 200, 'mint subscriber token');
  assert.equal((await json(r)).role, 'subscriber');

  r = await jsonReq(agoraUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: CHANNEL, role: 'host' }) }, agoraCookie);
  assert.equal(r.status, 400);
  r = await jsonReq(agoraUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: '' }) }, agoraCookie);
  assert.equal(r.status, 400);
  const unauth = await jsonReq(agoraUrl, '/api/live/token', { method: 'POST', body: JSON.stringify({ channel: CHANNEL }) });
  assert.equal(unauth.status, 401);
});
