'use strict';
/* Slice 1 backend tests: parent portal (links, link codes, children) + announcements. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, parentCookie, parentId, studentId, studentCookie;
let instAId, instBId, studentBId;

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

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-family-'));
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

  const insts = await json(await req('/api/admin/institutions', {}, superCookie));
  instAId = insts.institutions.find(i => i.slug === 'default').id;

  // Parent (via signup — no approval). Created before Second College so the
  // signup default-institution logic lands them in the default institution.
  r = await req('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Pat Parent', username: 'patparent', password: 'Password123456', role: 'parent', termsAccepted: true }) });
  await assertStatus(r, 201, 'parent signup');
  const created = await json(r);
  assert.equal(created.user.status, 'active', 'parent needs no approval');
  assert.equal(created.user.institutionId, instAId, 'parent lands in default institution');
  parentId = created.user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'patparent', password: 'Password123456' }) });
  await assertStatus(r, 200, 'parent login');
  parentCookie = cookieOf(r);

  // Second institution for cross-institution tests.
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Second College', slug: 'second-college' }) }, superCookie);
  await assertStatus(r, 201, 'create institution B');
  instBId = (await json(r)).institution.id;

  // Institution admin (has family.manage).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

  // Student A (institution A).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu A', email: 'stuA@example.com', password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create student A');
  studentId = (await json(r)).user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stuA@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student A login');
  studentCookie = cookieOf(r);

  // Student B (institution B).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu B', email: 'stuB@example.com', password: 'Password123456', role: 'student', institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'create student B');
  studentBId = (await json(r)).user.id;
});

test.after(async () => { try { serverProcess.kill('SIGTERM'); } catch {} });

test('admin creates parent link; duplicate is 409', async () => {
  let r = await req('/api/admin/parent-links', { method: 'POST', body: JSON.stringify({ parentId, studentId, relation: 'father' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create link');
  const link = (await json(r)).link;
  assert.equal(link.relation, 'father');

  r = await req('/api/admin/parent-links', { method: 'POST', body: JSON.stringify({ parentId, studentId, relation: 'mother' }) }, instAdminCookie);
  await assertStatus(r, 409, 'duplicate link');
});

test('cross-institution link is 403 for institution admin, allowed for super admin', async () => {
  let r = await req('/api/admin/parent-links', { method: 'POST', body: JSON.stringify({ parentId, studentId: studentBId, relation: 'guardian' }) }, instAdminCookie);
  await assertStatus(r, 403, 'cross-institution blocked');

  r = await req('/api/admin/parent-links', { method: 'POST', body: JSON.stringify({ parentId, studentId: studentBId, relation: 'guardian' }) }, superCookie);
  await assertStatus(r, 201, 'super admin cross-institution link');
});

test('parent sees only own children (no leak)', async () => {
  const r = await req('/api/parent/children', {}, parentCookie);
  await assertStatus(r, 200, 'children list');
  const children = (await json(r)).children;
  assert.equal(children.length, 2, 'parent linked to both students via admin + super admin links');
  for (const c of children) {
    assert.ok(c.student && c.student.id, 'child has student');
    assert.ok(c.progress && typeof c.progress.coursesEnrolled === 'number', 'child has progress');
    assert.ok(c.attendance && typeof c.attendance.present === 'number', 'child has attendance');
    assert.ok(!('passwordHash' in c.student), 'no password hash leak');
  }
});

test('unlinked student results are 403; linked results work', async () => {
  // Create a third student nobody links.
  let r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu C', email: 'stuC@example.com', password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create student C');
  const studentCId = (await json(r)).user.id;

  r = await req(`/api/parent/children/${studentCId}/results`, {}, parentCookie);
  await assertStatus(r, 403, 'unlinked results blocked');

  r = await req(`/api/parent/children/${studentId}/results`, {}, parentCookie);
  await assertStatus(r, 200, 'linked results');
  const body = await json(r);
  assert.ok(Array.isArray(body.results) && Array.isArray(body.certificates), 'results shape');
});

test('student link code + parent self-link sets institution', async () => {
  let r = await req('/api/student/link-code', {}, studentCookie);
  await assertStatus(r, 200, 'get link code');
  const code = (await json(r)).code;
  assert.match(code, /^[A-Z0-9]{8}$/, 'code shape');

  // New parent signs up (no institution yet — actually signup assigns default; clear it via fresh parent).
  r = await req('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Second Parent', username: 'secondparent', password: 'Password123456', role: 'parent', termsAccepted: true }) });
  await assertStatus(r, 201, 'second parent signup');
  const p2id = (await json(r)).user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'secondparent', password: 'Password123456' }) });
  const p2cookie = cookieOf(r);

  r = await req('/api/parent/link', { method: 'POST', body: JSON.stringify({ code }) }, p2cookie);
  await assertStatus(r, 201, 'self-link via code');
  const linked = await json(r);
  assert.equal(linked.student.id, studentId, 'linked to right student');

  // First link sets the parent's institution to the student's.
  r = await req('/api/auth/me', {}, p2cookie);
  await assertStatus(r, 200, 'parent me');
  assert.equal((await json(r)).user.institutionId, instAId, 'institution set on first link');

  // Duplicate self-link is 409.
  r = await req('/api/parent/link', { method: 'POST', body: JSON.stringify({ code }) }, p2cookie);
  await assertStatus(r, 409, 'duplicate self-link');

  // Bad code is 404.
  r = await req('/api/parent/link', { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZZZ' }) }, p2cookie);
  await assertStatus(r, 404, 'bad code');

  // Parent can now see the child.
  r = await req('/api/parent/children', {}, p2cookie);
  await assertStatus(r, 200, 'second parent children');
  assert.ok((await json(r)).children.some(c => c.student.id === studentId), 'child visible');
  assert.ok(p2id, 'parent id present');
});

test('announcements: admin CRUD perm-gated, audience filtering', async () => {
  // Student cannot create announcements.
  let r = await req('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: 'Hi', body: 'Hello', audience: 'all' }) }, studentCookie);
  await assertStatus(r, 403, 'student cannot create');

  // Institution admin creates parent-audience + teacher-audience announcements.
  r = await req('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: 'PTA Meeting', body: 'Meet on Friday', audience: 'parents' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create parent announcement');
  r = await req('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: 'Staff Only', body: 'Internal', audience: 'teachers' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create teacher announcement');
  const teacherAnnId = (await json(r)).announcement.id;

  // Parent sees parents+all, NOT teachers-only.
  r = await req('/api/parent/announcements', {}, parentCookie);
  await assertStatus(r, 200, 'parent announcements');
  const pAnns = (await json(r)).announcements;
  assert.ok(pAnns.some(a => a.title === 'PTA Meeting'), 'parent sees parent announcement');
  assert.ok(!pAnns.some(a => a.title === 'Staff Only'), 'parent does NOT see teacher announcement');

  // Student feed: students+all only.
  r = await req('/api/announcements', {}, studentCookie);
  await assertStatus(r, 200, 'student announcements feed');
  const sAnns = (await json(r)).announcements;
  assert.ok(!sAnns.some(a => a.title === 'Staff Only'), 'student does NOT see teacher announcement');
  assert.ok(!sAnns.some(a => a.title === 'PTA Meeting'), 'student does NOT see parent announcement');

  // Admin list + delete.
  r = await req('/api/admin/announcements', {}, instAdminCookie);
  await assertStatus(r, 200, 'admin list');
  assert.ok((await json(r)).announcements.length >= 2, 'admin sees all');
  r = await req(`/api/admin/announcements/${teacherAnnId}`, { method: 'DELETE' }, instAdminCookie);
  await assertStatus(r, 200, 'delete announcement');
  r = await req('/api/admin/announcements', {}, instAdminCookie);
  assert.ok(!(await json(r)).announcements.some(a => a.id === teacherAnnId), 'deleted gone');
});

test('parent-links admin list is org-scoped; student cannot touch admin routes', async () => {
  const r = await req('/api/admin/parent-links', {}, instAdminCookie);
  await assertStatus(r, 200, 'inst admin list');
  const links = (await json(r)).parentLinks;
  // institution_admin (instA) must not see the student-B (instB) link created by super admin.
  assert.ok(!links.some(l => l.studentId === studentBId), 'no cross-institution leak in list');

  const r2 = await req('/api/admin/parent-links', {}, studentCookie);
  await assertStatus(r2, 403, 'student blocked from admin links');
});
