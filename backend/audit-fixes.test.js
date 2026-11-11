'use strict';
/* Audit fixes (2026-11-10): the upload body cap, the admin library-loans list, and
 * regression guards for two routes the audit first misreported as missing
 * (POST /api/teacher/schedule via the generic /api/teacher/:kind handler, and
 * POST /api/community/follow/:id) — both exist and work; these tests lock that in. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, studentCookie, student2Cookie;
let teacherId, studentId, student2Id;

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

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-auditfixes-'));
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
  const s1 = await createStudent(baseUrl, 'Stu Dent', 'stux');
  studentCookie = s1.cookie; studentId = s1.id;
  const s2 = await createStudent(baseUrl, 'Sam Second', 'samx');
  student2Cookie = s2.cookie; student2Id = s2.id;
});

test.after(async () => {
  if (serverProcess) { serverProcess.kill(); await new Promise(r => serverProcess.once('exit', r)); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('upload accepts files well over the old 64KB JSON cap (100KB and 1MB)', async () => {
  for (const size of [100 * 1024, 1024 * 1024]) {
    const data = Buffer.alloc(size, 'x').toString('base64');
    const r = await jsonReq(baseUrl, '/api/upload', { method: 'POST', body: JSON.stringify({ filename: 'notes.txt', mimeType: 'text/plain', data, folder: 'assignments' }) }, studentCookie);
    await assertStatus(r, 201, `upload ${size} bytes`);
    const d = await json(r);
    assert.match(d.url, /^\/uploads\//);
  }
});

test('upload still enforces the 5MB decoded-file limit', async () => {
  const data = Buffer.alloc(6 * 1024 * 1024, 'x').toString('base64');
  const r = await jsonReq(baseUrl, '/api/upload', { method: 'POST', body: JSON.stringify({ filename: 'big.txt', mimeType: 'text/plain', data, folder: 'assignments' }) }, studentCookie);
  await assertStatus(r, 400, '6MB file rejected');
});

test('quizgen upload accepts a 100KB notes file', async () => {
  const text = 'Photosynthesis is how green plants convert sunlight into energy. '.repeat(2000);
  const data = Buffer.from(text, 'utf8').toString('base64');
  const r = await jsonReq(baseUrl, '/api/quizgen/upload', { method: 'POST', body: JSON.stringify({ filename: 'notes.txt', mimeType: 'text/plain', data }) }, studentCookie);
  await assertStatus(r, 200, 'quizgen upload 100KB');
  const d = await json(r);
  assert.ok(d.charCount > 1000);
});

test('ordinary JSON routes still reject bodies over 64KB', async () => {
  const r = await jsonReq(baseUrl, '/api/notes', { method: 'POST', body: JSON.stringify({ title: 'x', content: 'y'.repeat(100 * 1024) }) }, studentCookie);
  await assertStatus(r, 400, 'oversized note body rejected');
  const d = await json(r);
  assert.match(d.error, /too large/i);
});

test('admin library loans list shows a borrowed book with title + student name', async () => {
  let r = await jsonReq(baseUrl, '/api/admin/library', { method: 'POST', body: JSON.stringify({ title: 'Clean Code', kind: 'book', author: 'Robert Martin', totalCopies: 2 }) }, superCookie);
  await assertStatus(r, 201, 'create catalog item');
  const itemId = (await json(r)).item.id;
  r = await jsonReq(baseUrl, `/api/library/${itemId}/borrow`, { method: 'POST', body: '{}' }, studentCookie);
  await assertStatus(r, 201, 'student borrows');
  r = await jsonReq(baseUrl, '/api/admin/library/loans', { method: 'GET' }, superCookie);
  await assertStatus(r, 200, 'admin loans list');
  const { loans } = await json(r);
  assert.equal(loans.length, 1);
  assert.equal(loans[0].title, 'Clean Code');
  assert.equal(loans[0].studentName, 'Stu Dent');
  assert.equal(loans[0].overdue, false);
  r = await jsonReq(baseUrl, '/api/admin/library/loans', { method: 'GET' }, studentCookie);
  await assertStatus(r, 403, 'student blocked from admin loans');
});

test('teacher schedule endpoint works (generic /api/teacher/:kind handler)', async () => {
  let r = await jsonReq(baseUrl, '/api/admin/classes', { method: 'POST', body: JSON.stringify({ name: 'Class 10A', teacherIds: [teacherId], studentIds: [studentId] }) }, superCookie);
  await assertStatus(r, 201, 'create class');
  const classId = (await json(r)).class.id;
  r = await jsonReq(baseUrl, '/api/teacher/schedule', { method: 'POST', body: JSON.stringify({ classId, title: 'Fractions revision', course: 'Maths', date: '2026-11-12', time: '10:00' }) }, teacherCookie);
  await assertStatus(r, 201, 'schedule a class session');
  const d = await json(r);
  assert.equal(d.item.title, 'Fractions revision');
  r = await jsonReq(baseUrl, '/api/teacher', { method: 'GET' }, teacherCookie);
  const td = (await json(r)).teacherData;
  assert.ok((td.schedule || []).some(s => s.title === 'Fractions revision'));
});

test('community follow endpoint works', async () => {
  let r = await jsonReq(baseUrl, `/api/community/follow/${student2Id}`, { method: 'POST', body: JSON.stringify({ active: true }) }, studentCookie);
  await assertStatus(r, 200, 'follow');
  assert.equal((await json(r)).following, true);
  r = await jsonReq(baseUrl, `/api/community/follow/${student2Id}`, { method: 'POST', body: JSON.stringify({ active: false }) }, studentCookie);
  await assertStatus(r, 200, 'unfollow');
  assert.equal((await json(r)).following, false);
});
