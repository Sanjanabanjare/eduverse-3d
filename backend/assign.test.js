'use strict';
/* Slice 2 backend tests: assignment deadline enforcement + file uploads. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, studentCookie, teacherId, studentId, classId;
const uploadedPaths = [];

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
async function req(url, options, cookie) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options?.headers || {}), 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
}
async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { throw new Error(`Non-JSON (${res.status}): ${t.slice(0, 300)}`); }
}
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
}
async function createAssignment(body, cookie) {
  const r = await req('/api/assignments', { method: 'POST', body: JSON.stringify({ title: 'Homework', description: 'Do it.', classId, ...body }) }, cookie || teacherCookie);
  await assertStatus(r, 201, 'create assignment');
  return (await json(r)).assignment;
}
async function studentAssignments() {
  const r = await req('/api/assignments', {}, studentCookie);
  await assertStatus(r, 200, 'student list assignments');
  return (await json(r)).assignments;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-assign-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForServer();

  let r = await req('/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'super login');
  superCookie = cookieOf(r);

  r = await req('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Tina Teacher', username: 'tinateacher', password: 'Password123456', role: 'teacher', termsAccepted: true, otpVerified: true, otpCode: '123456' }) });
  await assertStatus(r, 201, 'teacher signup');
  teacherId = (await json(await req('/api/admin/users', {}, superCookie))).users.find(u => u.username === 'tinateacher').id;
  r = await req(`/api/admin/users/${teacherId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
  await assertStatus(r, 200, 'approve teacher');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tinateacher', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu A', email: 'stuA@example.com', password: 'Password123456', role: 'student' }) }, superCookie);
  await assertStatus(r, 201, 'create student A');
  studentId = (await json(r)).user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stuA@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student A login');
  studentCookie = cookieOf(r);

  r = await req('/api/admin/classes', { method: 'POST', body: JSON.stringify({ name: 'Assign Class', teacherIds: [teacherId], studentIds: [studentId] }) }, superCookie);
  await assertStatus(r, 201, 'create class');
  classId = (await json(r)).class.id;
});

test.after(async () => {
  try { serverProcess.kill('SIGTERM'); } catch {}
  for (const p of uploadedPaths) {
    try { await fs.unlink(path.isAbsolute(p) ? p : path.join(__dirname, '..', p)); } catch {}
  }
});

test('on-time text submit works; student view shows late:false', async () => {
  const a = await createAssignment({ dueDate: '2099-01-01T23:59' });
  assert.equal(a.allowLate, false);
  let r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'My on-time work.' }) }, studentCookie);
  await assertStatus(r, 200, 'on-time submit');
  const out = (await json(r)).assignment;
  assert.equal(out.status, 'submitted');
  assert.equal(out.late, false);
  const mine = (await studentAssignments()).find(x => x.id === a.id);
  assert.equal(mine.submission, 'My on-time work.');
  assert.equal(mine.late, false);
  assert.equal(mine.allowLate, false);
});

test('late submit rejected when allowLate is false', async () => {
  const a = await createAssignment({ dueDate: '2020-01-01' });
  const r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'Too late.' }) }, studentCookie);
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /deadline/i);
  const mine = (await studentAssignments()).find(x => x.id === a.id);
  assert.equal(mine.status, 'assigned');
});

test('late submit accepted with late:true when allowLate is true', async () => {
  const a = await createAssignment({ dueDate: '2020-01-01', allowLate: true });
  assert.equal(a.allowLate, true);
  const r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'Late but allowed.' }) }, studentCookie);
  await assertStatus(r, 200, 'late submit allowed');
  assert.equal((await json(r)).assignment.late, true);
  const mine = (await studentAssignments()).find(x => x.id === a.id);
  assert.equal(mine.late, true);
  assert.equal(mine.status, 'submitted');
});

test('PATCH allowLate flips the flag; students cannot patch', async () => {
  const a = await createAssignment({ dueDate: '2020-01-01' });
  let r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'Nope.' }) }, studentCookie);
  assert.equal(r.status, 400, 'blocked before flag flip');
  r = await req(`/api/assignments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ allowLate: true }) }, studentCookie);
  assert.equal(r.status, 403, 'student cannot patch');
  r = await req(`/api/assignments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ allowLate: true }) }, teacherCookie);
  await assertStatus(r, 200, 'teacher patches allowLate');
  assert.equal((await json(r)).assignment.allowLate, true);
  r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'Now allowed.' }) }, studentCookie);
  await assertStatus(r, 200, 'submit after flag flip');
  assert.equal((await json(r)).assignment.late, true);
});

test('fileUrl submit works (file-only and text+file); empty submit rejected', async () => {
  const a = await createAssignment({ dueDate: '2099-01-01T23:59' });
  let r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  assert.equal(r.status, 400, 'empty submit rejected');
  r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ fileUrl: '/uploads/assignments/essay.pdf', fileName: 'essay.pdf' }) }, studentCookie);
  await assertStatus(r, 200, 'file-only submit');
  let mine = (await studentAssignments()).find(x => x.id === a.id);
  assert.equal(mine.fileUrl, '/uploads/assignments/essay.pdf');
  assert.equal(mine.fileName, 'essay.pdf');
  assert.equal(mine.submission, '');
  // Resubmit with text + a new file overwrites (not yet graded).
  r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'See attached.', fileUrl: '/uploads/assignments/essay-v2.pdf', fileName: 'essay-v2.pdf' }) }, studentCookie);
  await assertStatus(r, 200, 'text+file resubmit');
  mine = (await studentAssignments()).find(x => x.id === a.id);
  assert.equal(mine.submission, 'See attached.');
  assert.equal(mine.fileUrl, '/uploads/assignments/essay-v2.pdf');
  // Teacher view carries the file fields too.
  r = await req('/api/assignments', {}, teacherCookie);
  const tview = (await json(r)).assignments.find(x => x.id === a.id);
  const sub = tview.submissions.find(s => s.studentId === studentId);
  assert.equal(sub.fileUrl, '/uploads/assignments/essay-v2.pdf');
  assert.equal(sub.fileName, 'essay-v2.pdf');
  assert.equal(sub.late, false);
});

test('graded + released submission still blocks resubmission', async () => {
  const a = await createAssignment({ dueDate: '2099-01-01T23:59' });
  let r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'First version.' }) }, studentCookie);
  await assertStatus(r, 200, 'initial submit');
  r = await req(`/api/teacher/grading/${a.id}/${studentId}`, { method: 'PATCH', body: JSON.stringify({ marks: 9, maxMarks: 10, feedback: 'Good.', release: true }) }, teacherCookie);
  await assertStatus(r, 200, 'grade + release');
  r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ submission: 'Trying again.' }) }, studentCookie);
  assert.equal(r.status, 403, 'resubmission blocked after release');
});

test('students can upload assignment files via /api/upload (assignments folder only)', async () => {
  const data = Buffer.from('%PDF-1.4 assignment file').toString('base64');
  let r = await req('/api/upload', { method: 'POST', body: JSON.stringify({ filename: 'homework.pdf', mimeType: 'application/pdf', data, folder: 'assignments' }) }, studentCookie);
  await assertStatus(r, 201, 'student assignment upload');
  const up = await json(r);
  assert.ok(String(up.url).startsWith('/uploads/'), 'returns an uploads url');
  if (up.path) uploadedPaths.push(up.path);
  // Student upload outside the assignments folder stays forbidden.
  r = await req('/api/upload', { method: 'POST', body: JSON.stringify({ filename: 'x.pdf', mimeType: 'application/pdf', data, folder: 'library' }) }, studentCookie);
  assert.equal(r.status, 403, 'student upload elsewhere forbidden');
  // End-to-end: the uploaded URL is accepted as a submission file.
  const a = await createAssignment({ dueDate: '2099-01-01T23:59' });
  r = await req(`/api/assignments/${a.id}/submit`, { method: 'POST', body: JSON.stringify({ fileUrl: up.url, fileName: 'homework.pdf' }) }, studentCookie);
  await assertStatus(r, 200, 'submit with uploaded file url');
});
