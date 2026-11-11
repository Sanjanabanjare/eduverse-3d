'use strict';
/* Slice 2 backend tests: classroom session records — end-classroom creates a record
 * from join/attendance data + client summary; list/detail scoping for teacher,
 * student, and admin (org-scoped). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, teacher2Cookie, studentCookie, student2Cookie;
let teacherId, studentId, student2Id;
let sessionId, otherSessionId, recordId;

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
function spawnServer(storePath, p) {
  return spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(p), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test' },
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
  const id = (await json(r)).user.id;
  r = await jsonReq(base, '/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCk);
  await assertStatus(r, 200, 'approve teacher ' + email);
  r = await jsonReq(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login ' + email);
  return { id, cookie: cookieOf(r) };
}
async function createStudent(base, name, username) {
  let r = await jsonReq(base, '/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, username, password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup ' + username);
  const id = (await json(r)).user.id;
  r = await jsonReq(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: username, password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login ' + username);
  return { id, cookie: cookieOf(r) };
}
async function createSession(base, cookie, title) {
  const r = await jsonReq(base, '/api/teacher/live-sessions', { method: 'POST', body: JSON.stringify({
    title, startsAt: new Date(Date.now() + 3600000).toISOString(),
    durationMin: 60, meetingUrl: 'https://meet.example.com/room-' + title.replace(/\s+/g, '-').toLowerCase(),
  }) }, cookie);
  await assertStatus(r, 201, 'create live session ' + title);
  return (await json(r)).session.id;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-sessionrec-'));
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

  const t1 = await createApprovedTeacher(baseUrl, superCookie, 'Tia Teacher', 'tia@example.com');
  teacherCookie = t1.cookie; teacherId = t1.id;
  const t2 = await createApprovedTeacher(baseUrl, superCookie, 'Tom Teacher', 'tom@example.com');
  teacher2Cookie = t2.cookie;

  const s1 = await createStudent(baseUrl, 'Stu Dent', 'stux');
  studentCookie = s1.cookie; studentId = s1.id;
  const s2 = await createStudent(baseUrl, 'Sam Second', 'samx');
  student2Cookie = s2.cookie; student2Id = s2.id;

  sessionId = await createSession(baseUrl, teacherCookie, 'Recorded Class');
  otherSessionId = await createSession(baseUrl, teacher2Cookie, 'Other Teacher Class');
});

test.after(async () => {
  if (serverProcess) { serverProcess.kill(); await new Promise(r => serverProcess.once('exit', r)); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('end-classroom creates a record merging server attendance with client summary', async () => {
  // Student joins (server-side attendance) and teacher joins.
  let r = await jsonReq(baseUrl, `/api/live-sessions/${sessionId}/join`, { method: 'POST', body: '{}' }, studentCookie);
  await assertStatus(r, 200, 'student join');
  r = await jsonReq(baseUrl, `/api/live-sessions/${sessionId}/join`, { method: 'POST', body: '{}' }, teacherCookie);
  await assertStatus(r, 200, 'teacher join');

  const summary = {
    participants: [
      { userId: studentId, leftAt: new Date().toISOString(), raisedHand: 2, chatCount: 5, qaCount: 2, pollVotes: 3 },
      // Client-only participant (never hit the join endpoint) is kept, not dropped.
      { userId: 'guest-1', name: 'Guest One', raisedHand: false, chatCount: 1, qaCount: 0, pollVotes: 0 },
    ],
    chatCount: 6, qaCount: 2,
    polls: [{ question: 'Was this clear?', options: ['Yes', 'No'], votes: [2, 0] }],
  };
  r = await jsonReq(baseUrl, `/api/live-sessions/${sessionId}/end-classroom`, { method: 'POST', body: JSON.stringify({ summary }) }, teacherCookie);
  await assertStatus(r, 201, 'end-classroom');
  const { record } = await json(r);
  recordId = record.id;
  assert.equal(record.sessionId, sessionId);
  assert.equal(record.title, 'Recorded Class');
  assert.equal(record.teacherId, teacherId);
  assert.equal(record.status, undefined, 'record carries no live status field');
  assert.ok(record.endedAt);
  assert.ok(record.durationMin >= 0);
  assert.equal(record.chatCount, 6);
  assert.equal(record.qaCount, 2);
  assert.equal(record.polls.length, 1);
  assert.equal(record.polls[0].question, 'Was this clear?');
  assert.deepEqual(record.polls[0].votes, [2, 0]);
  assert.match(record.recordingNote, /saved locally/);
  // Participants: server attendees (student + teacher) merged with client stats + guest.
  const stu = record.participants.find(p => p.userId === studentId);
  assert.ok(stu, 'student participant present');
  assert.ok(stu.joinedAt, 'server joinedAt kept');
  assert.equal(stu.raisedHand, 2);
  assert.equal(stu.chatCount, 5);
  assert.equal(stu.qaCount, 2);
  assert.equal(stu.pollVotes, 3);
  assert.ok(record.participants.some(p => p.userId === teacherId), 'teacher participant present');
  assert.ok(record.participants.some(p => p.userId === 'guest-1' && p.name === 'Guest One'), 'client-only participant kept');

  // The live session is now ended: joining is rejected.
  r = await jsonReq(baseUrl, `/api/live-sessions/${sessionId}/join`, { method: 'POST', body: '{}' }, student2Cookie);
  await assertStatus(r, 400, 'join after end rejected');
});

test('end-classroom is teacher-owner/admin only and idempotent', async () => {
  // Other teacher cannot end it.
  let r = await jsonReq(baseUrl, `/api/live-sessions/${otherSessionId}/end-classroom`, { method: 'POST', body: JSON.stringify({ summary: {} }) }, teacherCookie);
  await assertStatus(r, 404, 'other teacher end 404');
  // Student cannot end it.
  r = await jsonReq(baseUrl, `/api/live-sessions/${otherSessionId}/end-classroom`, { method: 'POST', body: JSON.stringify({ summary: {} }) }, studentCookie);
  await assertStatus(r, 404, 'student end 404');
  // Unknown session.
  r = await jsonReq(baseUrl, '/api/live-sessions/nope/end-classroom', { method: 'POST', body: JSON.stringify({ summary: {} }) }, teacherCookie);
  await assertStatus(r, 404, 'unknown session 404');
  // Re-ending the already-recorded session returns the same record, no duplicate.
  r = await jsonReq(baseUrl, `/api/live-sessions/${sessionId}/end-classroom`, { method: 'POST', body: JSON.stringify({ summary: {} }) }, teacherCookie);
  await assertStatus(r, 200, 're-end returns 200');
  const { record, alreadyRecorded } = await json(r);
  assert.equal(record.id, recordId);
  assert.equal(alreadyRecorded, true);
  // Admin can end the other teacher's session.
  r = await jsonReq(baseUrl, `/api/live-sessions/${otherSessionId}/end-classroom`, { method: 'POST', body: JSON.stringify({ summary: {} }) }, superCookie);
  await assertStatus(r, 201, 'admin end');
  const other = (await json(r)).record;
  assert.equal(other.sessionId, otherSessionId);
  assert.equal(other.participants.length, 0, 'no joins means no participants');
});

test('student sees only sessions they joined; teacher sees only their own', async () => {
  let r = await req(baseUrl, '/api/session-records', {}, studentCookie);
  await assertStatus(r, 200, 'student list');
  let list = (await json(r)).records;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, recordId);

  r = await req(baseUrl, '/api/session-records', {}, student2Cookie);
  await assertStatus(r, 200, 'other student list');
  list = (await json(r)).records;
  assert.equal(list.length, 0, 'non-participant sees nothing');

  r = await req(baseUrl, '/api/teacher/session-records', {}, teacherCookie);
  await assertStatus(r, 200, 'teacher list');
  list = (await json(r)).records;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, recordId);

  r = await req(baseUrl, '/api/teacher/session-records', {}, teacher2Cookie);
  await assertStatus(r, 200, 'other teacher list');
  list = (await json(r)).records;
  assert.equal(list.length, 1, 'other teacher sees their own record');
  assert.notEqual(list[0].id, recordId);
});

test('detail scoping: participant, teacher, admin only', async () => {
  let r = await req(baseUrl, '/api/session-records/' + recordId, {}, studentCookie);
  await assertStatus(r, 200, 'participant detail');
  assert.equal((await json(r)).record.id, recordId);

  r = await req(baseUrl, '/api/session-records/' + recordId, {}, teacherCookie);
  await assertStatus(r, 200, 'owner teacher detail');

  r = await req(baseUrl, '/api/session-records/' + recordId, {}, superCookie);
  await assertStatus(r, 200, 'admin detail');

  r = await req(baseUrl, '/api/session-records/' + recordId, {}, student2Cookie);
  await assertStatus(r, 404, 'non-participant detail 404');

  r = await req(baseUrl, '/api/session-records/' + recordId, {}, teacher2Cookie);
  await assertStatus(r, 404, 'other teacher detail 404');

  r = await req(baseUrl, '/api/session-records/nope', {}, superCookie);
  await assertStatus(r, 404, 'unknown record 404');
});

test('admin list is org-scoped and supports filters', async () => {
  let r = await req(baseUrl, '/api/admin/session-records', {}, superCookie);
  await assertStatus(r, 200, 'admin list');
  const list = (await json(r)).records;
  assert.equal(list.length, 2, 'both records visible to super admin');

  r = await req(baseUrl, '/api/admin/session-records?teacherId=' + teacherId, {}, superCookie);
  await assertStatus(r, 200, 'admin list filtered by teacher');
  const filtered = (await json(r)).records;
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, recordId);

  r = await req(baseUrl, '/api/admin/session-records', {}, studentCookie);
  await assertStatus(r, 403, 'student admin list 403');

  r = await req(baseUrl, '/api/admin/session-records', {}, teacherCookie);
  await assertStatus(r, 403, 'teacher admin list 403');
});
