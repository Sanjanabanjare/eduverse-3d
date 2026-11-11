'use strict';
/* Slice 3 backend tests: study groups — create/join-by-code/leave, members-only
 * 404 scoping, shared notes CRUD (last-writer-wins), message cap, owner delete
 * removes the group + notes + messages. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, studentCookie, student2Cookie, student3Cookie;
let teacherId, studentId, student2Id;
let groupId, inviteCode, noteId;

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
async function createCourse(base, cookie, title) {
  let r = await jsonReq(base, '/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title, description: 'Test course for study groups.' }) }, cookie);
  await assertStatus(r, 201, 'create course ' + title);
  return (await json(r)).course.id;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-studygroups-'));
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
  const s3 = await createStudent(baseUrl, 'Sue Third', 'suex');
  student3Cookie = s3.cookie;
});

test.after(async () => {
  if (serverProcess) { serverProcess.kill(); await new Promise(r => serverProcess.once('exit', r)); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('student creates a course-free group; owner is admin member with invite code', async () => {
  let r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'Physics revision crew', description: 'Weekly problem sets.' }) }, studentCookie);
  await assertStatus(r, 201, 'create group');
  const { group } = await json(r);
  groupId = group.id; inviteCode = group.inviteCode;
  assert.equal(group.name, 'Physics revision crew');
  assert.equal(group.courseId, null);
  assert.equal(group.ownerId, studentId);
  assert.match(group.inviteCode, /^[A-Z2-9]{8}$/);
  assert.equal(group.memberCount, 1);
  assert.equal(group.members[0].role, 'admin');
  // Validation: name too short.
  r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'AB' }) }, studentCookie);
  await assertStatus(r, 400, 'short name rejected');
});

test('teacher creates a group for their own course; student cannot attach a course', async () => {
  const courseId = await createCourse(baseUrl, teacherCookie, 'Biology 101');
  let r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'Bio study circle', courseId }) }, teacherCookie);
  await assertStatus(r, 201, 'teacher course group');
  const { group } = await json(r);
  assert.equal(group.courseId, courseId);
  assert.equal(group.courseTitle, 'Biology 101');
  // Teacher deletes their own course group (cleanup; also exercises owner delete).
  r = await req(baseUrl, `/api/study-groups/${group.id}`, { method: 'DELETE' }, teacherCookie);
  await assertStatus(r, 200, 'owner delete course group');
  // Student with a courseId is refused.
  r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'Sneaky group', courseId }) }, studentCookie);
  await assertStatus(r, 403, 'student course group refused');
  // Unknown course is 404.
  r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'Ghost group', courseId: 'no-such-course' }) }, teacherCookie);
  await assertStatus(r, 404, 'unknown course 404');
});

test('join by invite code and by group id; wrong code 403; non-member 404 on group routes', async () => {
  // Wrong code on the group join endpoint.
  let r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({ inviteCode: 'ZZZZZZZZ' }) }, student2Cookie);
  await assertStatus(r, 403, 'wrong code 403');
  // Correct code via the group endpoint.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({ inviteCode }) }, student2Cookie);
  await assertStatus(r, 200, 'join by group id');
  assert.equal((await json(r)).group.memberCount, 2);
  // Join again is idempotent.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({ inviteCode }) }, student2Cookie);
  await assertStatus(r, 200, 're-join idempotent');
  assert.equal((await json(r)).alreadyMember, true);
  // Join-by-code endpoint (code only) for the third student; unknown code 404.
  r = await jsonReq(baseUrl, '/api/study-groups/join-by-code', { method: 'POST', body: JSON.stringify({ inviteCode: 'NOPE1234' }) }, student3Cookie);
  await assertStatus(r, 404, 'unknown code 404');
  r = await jsonReq(baseUrl, '/api/study-groups/join-by-code', { method: 'POST', body: JSON.stringify({ inviteCode: inviteCode.toLowerCase() }) }, student3Cookie);
  await assertStatus(r, 200, 'join-by-code (case-insensitive)');
  // Non-member (a fresh outsider is not available here, so use the teacher who never joined).
  r = await req(baseUrl, `/api/study-groups/${groupId}`, { method: 'GET' }, teacherCookie);
  await assertStatus(r, 404, 'non-member detail 404');
  r = await req(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'GET' }, teacherCookie);
  await assertStatus(r, 404, 'non-member notes 404');
  r = await req(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'GET' }, teacherCookie);
  await assertStatus(r, 404, 'non-member messages 404');
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'POST', body: JSON.stringify({ title: 'X', content: 'Y' }) }, teacherCookie);
  await assertStatus(r, 404, 'non-member note create 404');
  // Members see the group in their list; the teacher does not.
  r = await req(baseUrl, '/api/study-groups', { method: 'GET' }, student2Cookie);
  await assertStatus(r, 200, 'member list');
  assert.ok((await json(r)).groups.some(g => g.id === groupId), 'member list includes group');
  r = await req(baseUrl, '/api/study-groups', { method: 'GET' }, teacherCookie);
  assert.ok(!(await json(r)).groups.some(g => g.id === groupId), 'non-member list excludes group');
});

test('shared notes: create, edit by another member (last-writer-wins), delete rules', async () => {
  let r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'POST', body: JSON.stringify({ title: 'Chapter 1 summary', content: 'Force equals mass times acceleration.' }) }, studentCookie);
  await assertStatus(r, 201, 'create note');
  const note = (await json(r)).note;
  noteId = note.id;
  assert.equal(note.authorId, studentId);
  assert.equal(note.title, 'Chapter 1 summary');
  // Another member edits — last-writer-wins.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Chapter 1 summary (revised)', content: 'F = m * a. Updated by Sam.' }) }, student2Cookie);
  await assertStatus(r, 200, 'member edit note');
  const edited = (await json(r)).note;
  assert.equal(edited.content, 'F = m * a. Updated by Sam.');
  assert.equal(edited.lastEditedBy, student2Id);
  // List shows the revised note.
  r = await req(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'GET' }, student3Cookie);
  await assertStatus(r, 200, 'list notes');
  const listed = (await json(r)).notes.find(n => n.id === noteId);
  assert.equal(listed.title, 'Chapter 1 summary (revised)');
  // A plain member who is neither author nor admin cannot delete the note.
  r = await req(baseUrl, `/api/study-groups/${groupId}/notes/${noteId}`, { method: 'DELETE' }, student3Cookie);
  await assertStatus(r, 403, 'non-author member cannot delete note');
  // Author deletes it.
  r = await req(baseUrl, `/api/study-groups/${groupId}/notes/${noteId}`, { method: 'DELETE' }, studentCookie);
  await assertStatus(r, 200, 'author deletes note');
  r = await req(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'GET' }, studentCookie);
  assert.ok(!(await json(r)).notes.some(n => n.id === noteId), 'note gone after delete');
  // Validation: empty content rejected.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/notes`, { method: 'POST', body: JSON.stringify({ title: 'Empty', content: '   ' }) }, studentCookie);
  await assertStatus(r, 400, 'empty note rejected');
});

test('group chat: post, list, 500-char cap, non-member blocked', async () => {
  let r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Meet at 5pm?' }) }, studentCookie);
  await assertStatus(r, 201, 'post message');
  const msg = (await json(r)).message;
  assert.equal(msg.authorName, 'Stu Dent');
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Yes — bring the workbook.' }) }, student2Cookie);
  await assertStatus(r, 201, 'second message');
  r = await req(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'GET' }, student3Cookie);
  await assertStatus(r, 200, 'list messages');
  const messages = (await json(r)).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, 'Meet at 5pm?');
  assert.equal(messages[1].text, 'Yes — bring the workbook.');
  // Over-long message rejected.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(501) }) }, studentCookie);
  await assertStatus(r, 400, '501-char message rejected');
  // Non-member cannot post.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Hello?' }) }, teacherCookie);
  await assertStatus(r, 404, 'non-member message 404');
});

test('leave: owner transfer to earliest member; last member leaving deletes the group', async () => {
  // student3 leaves first (plain member).
  let r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/leave`, { method: 'POST', body: '{}' }, student3Cookie);
  await assertStatus(r, 200, 'member leaves');
  assert.equal((await json(r)).left, true);
  r = await req(baseUrl, `/api/study-groups/${groupId}`, { method: 'GET' }, student3Cookie);
  await assertStatus(r, 404, 'leaver no longer sees group');
  // Owner (student) leaves: ownership transfers to the earliest remaining member (student2).
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/leave`, { method: 'POST', body: '{}' }, studentCookie);
  await assertStatus(r, 200, 'owner leaves');
  r = await req(baseUrl, `/api/study-groups/${groupId}`, { method: 'GET' }, student2Cookie);
  await assertStatus(r, 200, 'new owner sees group');
  const group = (await json(r)).group;
  assert.equal(group.ownerId, student2Id);
  assert.equal(group.members.find(m => m.userId === student2Id).role, 'admin');
  // student2 re-invites student (owner) via code, then student leaves again as plain member.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/join`, { method: 'POST', body: JSON.stringify({ inviteCode }) }, studentCookie);
  await assertStatus(r, 200, 're-join after ownership transfer');
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/leave`, { method: 'POST', body: '{}' }, studentCookie);
  await assertStatus(r, 200, 'plain member leaves again');
  // Last member (student2, the owner) leaves: group is deleted.
  r = await jsonReq(baseUrl, `/api/study-groups/${groupId}/leave`, { method: 'POST', body: '{}' }, student2Cookie);
  await assertStatus(r, 200, 'last member leaves');
  assert.equal((await json(r)).groupDeleted, true);
  r = await req(baseUrl, '/api/study-groups', { method: 'GET' }, student2Cookie);
  assert.ok(!(await json(r)).groups.some(g => g.id === groupId), 'group gone from list');
});

test('owner delete removes the group plus its notes and messages', async () => {
  // Fresh group with content, then delete.
  let r = await jsonReq(baseUrl, '/api/study-groups', { method: 'POST', body: JSON.stringify({ name: 'Delete-me group' }) }, studentCookie);
  await assertStatus(r, 201, 'create group to delete');
  const gid = (await json(r)).group.id;
  r = await jsonReq(baseUrl, `/api/study-groups/${gid}/join`, { method: 'POST', body: JSON.stringify({ inviteCode: (await json(await req(baseUrl, `/api/study-groups/${gid}`, { method: 'GET' }, studentCookie))).group.inviteCode }) }, student2Cookie);
  await assertStatus(r, 200, 'second member joins delete-me group');
  r = await jsonReq(baseUrl, `/api/study-groups/${gid}/notes`, { method: 'POST', body: JSON.stringify({ title: 'Doomed note', content: 'Will be deleted.' }) }, studentCookie);
  await assertStatus(r, 201, 'note in delete-me group');
  r = await jsonReq(baseUrl, `/api/study-groups/${gid}/messages`, { method: 'POST', body: JSON.stringify({ text: 'Doomed message' }) }, student2Cookie);
  await assertStatus(r, 201, 'message in delete-me group');
  // A plain member cannot delete the group.
  r = await req(baseUrl, `/api/study-groups/${gid}`, { method: 'DELETE' }, student2Cookie);
  await assertStatus(r, 404, 'plain member cannot delete group');
  // Owner deletes.
  r = await req(baseUrl, `/api/study-groups/${gid}`, { method: 'DELETE' }, studentCookie);
  await assertStatus(r, 200, 'owner deletes group');
  assert.equal((await json(r)).deleted, true);
  r = await req(baseUrl, `/api/study-groups/${gid}`, { method: 'GET' }, studentCookie);
  await assertStatus(r, 404, 'deleted group 404');
  r = await req(baseUrl, `/api/study-groups/${gid}/notes`, { method: 'GET' }, studentCookie);
  await assertStatus(r, 404, 'deleted group notes 404');
  r = await req(baseUrl, `/api/study-groups/${gid}/messages`, { method: 'GET' }, studentCookie);
  await assertStatus(r, 404, 'deleted group messages 404');
});
