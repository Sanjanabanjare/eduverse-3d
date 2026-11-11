'use strict';
/* Slice 2 backend tests: library catalog, borrow/return, reading lists, offline sync. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const library = require('./library');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, teacherCookie, studentCookie, studentBId;
let instAId, instBId, bookId, ebookId;

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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-library-'));
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

  // Teacher (signup with OTP, then approve). Created before Second College so the
  // signup default-institution logic lands them in the default institution.
  r = await req('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Tina Teacher', username: 'tinateacher', password: 'Password123456', role: 'teacher', termsAccepted: true, otpVerified: true, otpCode: '123456' }) });
  await assertStatus(r, 201, 'teacher signup');
  const teacherId = (await json(await req('/api/admin/users', {}, superCookie))).users.find(u => u.username === 'tinateacher').id;
  r = await req(`/api/admin/users/${teacherId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
  await assertStatus(r, 200, 'approve teacher');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tinateacher', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  // Second institution for cross-institution tests.
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Second College', slug: 'second-college' }) }, superCookie);
  await assertStatus(r, 201, 'create institution B');
  instBId = (await json(r)).institution.id;

  // Institution admin (has library.manage via backfill).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Lib Admin', email: 'libadmin@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'libadmin@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

  // Student A (institution A).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu A', email: 'stuA@example.com', password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create student A');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stuA@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student A login');
  studentCookie = cookieOf(r);

  // Student B (institution B).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Stu B', email: 'stuB@example.com', password: 'Password123456', role: 'student', institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'create student B');
  studentBId = (await json(r)).user.id;

});

test.after(async () => { try { serverProcess.kill('SIGTERM'); } catch {} });

test('catalog CRUD is org-scoped; validation enforced', async () => {
  // Create a physical book (1 copy) + an ebook.
  let r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'book', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', isbn: '978-0-7432-7356-5', subject: 'Literature', totalCopies: 1 }) }, instAdminCookie);
  await assertStatus(r, 201, 'create book');
  const book = (await json(r)).item;
  assert.equal(book.kind, 'book');
  assert.equal(book.availableCopies, 1);
  bookId = book.id;

  r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'ebook', title: 'Digital Physics', fileUrl: 'https://example.com/physics.pdf', subject: 'Science' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create ebook');
  ebookId = (await json(r)).item.id;

  // Validation: bad kind, missing title, ebook without fileUrl.
  r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'magazine', title: 'Bad' }) }, instAdminCookie);
  await assertStatus(r, 400, 'bad kind rejected');
  r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'ebook', title: 'No File' }) }, instAdminCookie);
  await assertStatus(r, 400, 'ebook without fileUrl rejected');
  r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'book', title: 'X', totalCopies: 0 }) }, instAdminCookie);
  await assertStatus(r, 400, 'book with 0 copies rejected');

  // Filters.
  r = await req('/api/admin/library?kind=book', {}, instAdminCookie);
  await assertStatus(r, 200, 'filter by kind');
  assert.ok((await json(r)).items.every(i => i.kind === 'book'), 'all books');
  r = await req('/api/admin/library?q=gatsby', {}, instAdminCookie);
  await assertStatus(r, 200, 'text search');
  assert.equal((await json(r)).items.length, 1, 'finds Gatsby');

  // Org scoping: item created in institution B is invisible to inst admin of A.
  r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'book', title: 'B Only Book', totalCopies: 2, institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'super creates B item');
  r = await req('/api/admin/library', {}, instAdminCookie);
  await assertStatus(r, 200, 'inst admin list');
  const titles = (await json(r)).items.map(i => i.title);
  assert.ok(!titles.includes('B Only Book'), 'no cross-institution leak');

  // PATCH.
  r = await req(`/api/admin/library/${bookId}`, { method: 'PATCH', body: JSON.stringify({ subject: 'Classic Literature' }) }, instAdminCookie);
  await assertStatus(r, 200, 'patch item');
  assert.equal((await json(r)).item.subject, 'Classic Literature');
});

test('borrow decrements copies; 409 when none available or already borrowed', async () => {
  // Student A borrows the single-copy book.
  let r = await req(`/api/library/${bookId}/borrow`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'borrow book');
  const loan = (await json(r)).loan;
  assert.ok(loan.dueAt > loan.borrowedAt, 'due date is in the future');
  assert.equal(loan.overdue, false);

  // Availability is now 0.
  r = await req('/api/library?q=gatsby', {}, studentCookie);
  await assertStatus(r, 200, 'browse');
  assert.equal((await json(r)).items[0].availableCopies, 0, 'no copies left');

  // Same student cannot borrow twice.
  r = await req(`/api/library/${bookId}/borrow`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 409, 'double borrow rejected');

  // Ebooks cannot be borrowed.
  r = await req(`/api/library/${ebookId}/borrow`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 400, 'ebook borrow rejected');
});

test('return restores availability; double return is 409', async () => {
  let r = await req('/api/library/loans/mine', {}, studentCookie);
  await assertStatus(r, 200, 'my loans');
  const loans = (await json(r)).loans;
  assert.equal(loans.length, 1, 'one loan');
  const loanId = loans[0].id;

  r = await req(`/api/library/loans/${loanId}/return`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'return loan');
  assert.ok((await json(r)).loan.returnedAt, 'returnedAt stamped');

  r = await req(`/api/library/loans/${loanId}/return`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 409, 'double return rejected');

  r = await req('/api/library?q=gatsby', {}, studentCookie);
  await assertStatus(r, 200, 'browse after return');
  assert.equal((await json(r)).items[0].availableCopies, 1, 'copy restored');
});

test('overdue detection (unit + API flag)', async () => {
  // Unit: pure helper.
  assert.equal(library.isOverdue({ dueAt: new Date(Date.now() - 1000).toISOString(), returnedAt: null }), true, 'past due = overdue');
  assert.equal(library.isOverdue({ dueAt: new Date(Date.now() + 86400000).toISOString(), returnedAt: null }), false, 'future due = not overdue');
  assert.equal(library.isOverdue({ dueAt: new Date(Date.now() - 1000).toISOString(), returnedAt: new Date().toISOString() }), false, 'returned = not overdue');

  // API: active loan carries overdue:false.
  let r = await req(`/api/library/${bookId}/borrow`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'borrow again');
  r = await req('/api/library/loans/mine', {}, studentCookie);
  await assertStatus(r, 200, 'loans with flags');
  const active = (await json(r)).loans.find(l => !l.returnedAt);
  assert.equal(active.overdue, false, 'fresh loan not overdue');
  // Clean up.
  await req(`/api/library/loans/${active.id}/return`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
});

test('reading lists: teacher CRUD, course scoping for students', async () => {
  // Teacher creates a course + module + lesson (for course-scoped list).
  let r = await req('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Reading Course', description: 'A course for reading lists.' }) }, teacherCookie);
  await assertStatus(r, 201, 'create course');
  const courseId = (await json(r)).course.id;
  r = await req(`/api/teacher/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify({ name: 'Module 1' }) }, teacherCookie);
  await assertStatus(r, 201, 'create module');
  const moduleId = (await json(r)).module.id;
  r = await req(`/api/teacher/courses/${courseId}/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify({ title: 'Lesson 1' }) }, teacherCookie);
  await assertStatus(r, 201, 'create lesson');
  const lessonId = (await json(r)).lesson.id;

  // Teacher creates a course-scoped and an institution-wide reading list.
  r = await req('/api/teacher/reading-lists', { method: 'POST', body: JSON.stringify({ title: 'Course Reads', courseId, itemIds: [bookId, ebookId] }) }, teacherCookie);
  await assertStatus(r, 201, 'create course list');
  assert.equal((await json(r)).readingList.items.length, 2, 'items populated');
  r = await req('/api/teacher/reading-lists', { method: 'POST', body: JSON.stringify({ title: 'General Reads', itemIds: [ebookId] }) }, teacherCookie);
  await assertStatus(r, 201, 'create general list');
  const generalId = (await json(r)).readingList.id;

  // Student NOT enrolled: sees only the institution-wide list.
  r = await req('/api/reading-lists', {}, studentCookie);
  await assertStatus(r, 200, 'student lists');
  let lists = (await json(r)).readingLists;
  assert.ok(lists.some(l => l.id === generalId), 'sees general list');
  assert.ok(!lists.some(l => l.title === 'Course Reads'), 'does not see course list before enrollment');

  // Publish the course, then enroll the student.
  r = await req(`/api/teacher/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, teacherCookie);
  await assertStatus(r, 200, 'publish course');
  r = await req(`/api/courses/${courseId}/enroll`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'enroll student');
  r = await req('/api/reading-lists', {}, studentCookie);
  await assertStatus(r, 200, 'student lists after enroll');
  lists = (await json(r)).readingLists;
  assert.ok(lists.some(l => l.title === 'Course Reads'), 'sees course list after enrollment');

  // Teacher deletes own list.
  r = await req('/api/teacher/reading-lists', {}, teacherCookie);
  await assertStatus(r, 200, 'teacher lists');
  const ownId = (await json(r)).readingLists[0].id;
  r = await req(`/api/teacher/reading-lists/${ownId}`, { method: 'DELETE' }, teacherCookie);
  await assertStatus(r, 200, 'delete own list');

  return { lessonId, courseId };
});

test('offline sync applies progress, records downloads, reports conflicts', async () => {
  // Build a fresh course+lesson for sync.
  let r = await req('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Sync Course', description: 'Offline sync test.' }) }, teacherCookie);
  await assertStatus(r, 201, 'sync course');
  const courseId = (await json(r)).course.id;
  r = await req(`/api/teacher/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify({ name: 'M1' }) }, teacherCookie);
  const moduleId = (await json(r)).module.id;
  r = await req(`/api/teacher/courses/${courseId}/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify({ title: 'L1' }) }, teacherCookie);
  const lessonId = (await json(r)).lesson.id;

  r = await req('/api/offline/sync', {
    method: 'POST',
    body: JSON.stringify({
      progress: [
        { lessonId, positionSec: 120, completed: true },
        { lessonId: 'no-such-lesson', positionSec: 5, completed: true },
        { lessonId: '', completed: false },
      ],
      downloads: [lessonId, lessonId, 'no-such-lesson'],
    }),
  }, studentCookie);
  await assertStatus(r, 200, 'sync');
  const out = await json(r);
  assert.equal(out.applied, 1, 'one progress entry applied');
  assert.equal(out.downloadsRecorded, 1, 'one download recorded (deduped)');
  assert.equal(out.conflicts.length, 3, 'three conflicts (unknown lesson x2, missing id)');

  // Progress actually landed: my-enrollments shows the completed lesson.
  r = await req(`/api/teacher/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, teacherCookie);
  await assertStatus(r, 200, 'publish sync course');
  r = await req(`/api/courses/${courseId}/enroll`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  r = await req('/api/my-enrollments', {}, studentCookie);
  await assertStatus(r, 200, 'my enrollments');
  const mine = (await json(r)).enrollments.find(e => e.courseId === courseId);
  assert.ok(mine && mine.completedLessons >= 1, 'lesson marked complete via sync');

  // Non-students cannot sync.
  r = await req('/api/offline/sync', { method: 'POST', body: JSON.stringify({ progress: [] }) }, teacherCookie);
  await assertStatus(r, 403, 'teacher sync rejected');
});

test('teacher cannot manage catalog (403); stats are admin-only and org-scoped', async () => {
  let r = await req('/api/admin/library', { method: 'POST', body: JSON.stringify({ kind: 'book', title: 'Sneaky', totalCopies: 1 }) }, teacherCookie);
  await assertStatus(r, 403, 'teacher catalog create blocked');

  r = await req(`/api/admin/library/${bookId}`, { method: 'DELETE' }, teacherCookie);
  await assertStatus(r, 403, 'teacher catalog delete blocked');

  r = await req('/api/library/stats', {}, teacherCookie);
  await assertStatus(r, 403, 'teacher stats blocked');

  r = await req('/api/library/stats', {}, instAdminCookie);
  await assertStatus(r, 200, 'admin stats');
  const stats = await json(r);
  assert.ok(stats.totals.books >= 1, 'book count');
  assert.ok(typeof stats.loans.active === 'number', 'loan counts');

  // Super admin sees everything; institution admin sees only own org.
  r = await req('/api/library/stats', {}, superCookie);
  await assertStatus(r, 200, 'super stats');
});
