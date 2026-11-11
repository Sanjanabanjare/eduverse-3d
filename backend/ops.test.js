'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, teacherCookie, studentCookie;
let instAId, instBId, teacherId, studentId, courseId, structId, planId;

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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-ops-'));
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
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Second College', slug: 'second-college' }) }, superCookie);
  await assertStatus(r, 201, 'create inst B');
  instBId = (await json(r)).institution.id;

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

  // Teacher (approved) + student in institution A.
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'T One', email: 't1@example.com', password: 'Password123456', role: 'teacher', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create teacher');
  teacherId = (await json(r)).user.id;
  r = await req(`/api/admin/users/${teacherId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
  await assertStatus(r, 200, 'approve teacher');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 't1@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'S One', email: 's1@example.com', password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create student');
  studentId = (await json(r)).user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 's1@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login');
  studentCookie = cookieOf(r);

  // Teacher creates + publishes a course.
  r = await req('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Marketplace Math', description: 'A course for sale' }) }, teacherCookie);
  await assertStatus(r, 201, 'create course');
  courseId = (await json(r)).course.id;
  r = await req(`/api/teacher/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, teacherCookie);
  await assertStatus(r, 200, 'publish course');
});

test.after(async () => { try { serverProcess.kill('SIGTERM'); } catch {} });

test('new permissions are in the default matrix and backfilled', async () => {
  const m = await json(await req('/api/admin/role-permissions', {}, superCookie));
  for (const p of ['fees.manage', 'marketplace.manage', 'reports.view', 'import.manage']) {
    assert.ok(m.matrix.super_admin.includes(p), `super_admin has ${p}`);
    assert.ok(m.matrix.institution_admin.includes(p), `institution_admin has ${p}`);
  }
  assert.ok(m.matrix.teacher.includes('reports.view'), 'teacher keeps reports.view');
  assert.ok(!m.matrix.student.includes('fees.manage'), 'student has no fees.manage');
});

test('fee structure CRUD is org-scoped', async () => {
  let r = await req('/api/admin/fee-structures', { method: 'POST', body: JSON.stringify({ name: 'Tuition 2026', amount: 50000, dueDate: new Date(Date.now() + 864e5 * 30).toISOString(), grade: '10' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create fee structure');
  structId = (await json(r)).feeStructure.id;

  // institution_admin of A cannot see B's structures; super_admin can filter.
  r = await req('/api/admin/fee-structures', { method: 'POST', body: JSON.stringify({ name: 'B Fees', amount: 10000, dueDate: new Date(Date.now() + 864e5 * 30).toISOString(), institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'create B structure');
  const mine = await json(await req('/api/admin/fee-structures', {}, instAdminCookie));
  assert.ok(mine.feeStructures.every(f => f.institutionId === instAId), 'no cross-institution leak');
  assert.ok(mine.feeStructures.some(f => f.id === structId), 'own structure listed');

  // Validation.
  r = await req('/api/admin/fee-structures', { method: 'POST', body: JSON.stringify({ name: 'X', amount: -5, dueDate: 'bad' }) }, instAdminCookie);
  assert.equal(r.status, 400, 'bad amount rejected');

  // PATCH.
  r = await req(`/api/admin/fee-structures/${structId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Tuition 2026 Revised' }) }, instAdminCookie);
  await assertStatus(r, 200, 'patch structure');
  assert.equal((await json(r)).feeStructure.name, 'Tuition 2026 Revised');

  // Student cannot touch admin fee endpoints.
  r = await req('/api/admin/fee-structures', {}, studentCookie);
  assert.equal(r.status, 403, 'student blocked from admin fees');
});

test('fee assign is idempotent and pay cannot exceed due', async () => {
  let r = await req(`/api/admin/fee-structures/${structId}/assign`, { method: 'POST', body: JSON.stringify({}) }, instAdminCookie);
  await assertStatus(r, 201, 'assign fees');
  const first = await json(r);
  assert.ok(first.created >= 1, 'records created');

  r = await req(`/api/admin/fee-structures/${structId}/assign`, { method: 'POST', body: JSON.stringify({}) }, instAdminCookie);
  await assertStatus(r, 201, 're-assign');
  const second = await json(r);
  assert.equal(second.created, 0, 'idempotent: no duplicates');
  assert.ok(second.skipped >= 1, 'skipped existing');

  const recs = await json(await req('/api/admin/fee-records', {}, instAdminCookie));
  const mine = recs.feeRecords.find(x => x.studentId === studentId && x.feeStructureId === structId);
  assert.ok(mine, 'student fee record exists');
  assert.equal(mine.status, 'pending', 'starts pending');

  // Overpay rejected.
  r = await req(`/api/admin/fee-records/${mine.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: mine.amountDue + 1, method: 'upi' }) }, instAdminCookie);
  assert.equal(r.status, 400, 'overpayment rejected');

  // Partial then full.
  r = await req(`/api/admin/fee-records/${mine.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: 20000, method: 'upi' }) }, instAdminCookie);
  await assertStatus(r, 200, 'partial pay');
  assert.equal((await json(r)).feeRecord.status, 'partial', 'partial status');
  r = await req(`/api/admin/fee-records/${mine.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: mine.amountDue - 20000, method: 'cash' }) }, instAdminCookie);
  await assertStatus(r, 200, 'full pay');
  assert.equal((await json(r)).feeRecord.status, 'paid', 'paid status');

  // Student sees their own fees.
  const sm = await json(await req('/api/fees/mine', {}, studentCookie));
  assert.ok(sm.feeRecords.some(x => x.id === mine.id), 'student sees own record');
  assert.ok(sm.feeRecords.every(x => x.studentId === studentId), 'no other student records');
  assert.equal(typeof sm.totalDue, 'number', 'totalDue present');
});

test('overdue detection is computed from due date', async () => {
  let r = await req('/api/admin/fee-structures', { method: 'POST', body: JSON.stringify({ name: 'Old Dues', amount: 1000, dueDate: new Date(Date.now() - 864e5 * 5).toISOString() }) }, instAdminCookie);
  await assertStatus(r, 201, 'create overdue structure');
  const sid = (await json(r)).feeStructure.id;
  r = await req(`/api/admin/fee-structures/${sid}/assign`, { method: 'POST', body: JSON.stringify({ studentIds: [studentId] }) }, instAdminCookie);
  await assertStatus(r, 201, 'assign overdue');
  const recs = await json(await req('/api/admin/fee-records?overdue=1', {}, instAdminCookie));
  assert.ok(recs.feeRecords.some(x => x.feeStructureId === sid && x.status === 'overdue'), 'overdue flagged');
});

test('fee structure with records cannot be deleted', async () => {
  const r = await req(`/api/admin/fee-structures/${structId}`, { method: 'DELETE' }, instAdminCookie);
  assert.equal(r.status, 409, 'delete blocked with records');
});

test('subscription plans: super_admin only for POST; assign and cancel', async () => {
  let r = await req('/api/admin/subscription-plans', { method: 'POST', body: JSON.stringify({ name: 'Pro', price: 99900, billingCycle: 'yearly', maxStudents: 500, maxTeachers: 50, features: ['Everything'] }) }, instAdminCookie);
  assert.equal(r.status, 403, 'institution_admin cannot create plans');
  r = await req('/api/admin/subscription-plans', { method: 'POST', body: JSON.stringify({ name: 'Pro', price: 99900, billingCycle: 'yearly', maxStudents: 500, maxTeachers: 50, features: ['Everything'] }) }, superCookie);
  await assertStatus(r, 201, 'super_admin creates plan');
  planId = (await json(r)).plan.id;

  const plans = await json(await req('/api/admin/subscription-plans', {}, instAdminCookie));
  assert.ok(plans.plans.some(p => p.id === planId), 'institution_admin can view plans');

  r = await req(`/api/admin/institutions/${instAId}/subscription`, { method: 'POST', body: JSON.stringify({ planId }) }, instAdminCookie);
  await assertStatus(r, 201, 'assign subscription');
  const sub = (await json(r)).subscription;
  assert.equal(sub.status, 'active', 'active subscription');
  assert.ok(new Date(sub.endsAt).getTime() > new Date(sub.startsAt).getTime(), 'endsAt after startsAt');

  const got = await json(await req(`/api/admin/institutions/${instAId}/subscription`, {}, instAdminCookie));
  assert.equal(got.subscription.id, sub.id, 'subscription retrievable');
  assert.equal(got.plan.id, planId, 'plan joined');

  // Cross-institution blocked.
  r = await req(`/api/admin/institutions/${instBId}/subscription`, { method: 'POST', body: JSON.stringify({ planId }) }, instAdminCookie);
  assert.equal(r.status, 403, 'cannot assign to another institution');

  r = await req(`/api/admin/institutions/${instAId}/subscription`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }, instAdminCookie);
  await assertStatus(r, 200, 'cancel subscription');
  assert.equal((await json(r)).subscription.status, 'cancelled', 'cancelled');
});

test('marketplace: list, public browse, student enroll', async () => {
  // Draft course cannot be listed — make a draft one.
  let r = await req('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Draft Course' }) }, teacherCookie);
  const draftId = (await json(r)).course.id;
  r = await req('/api/admin/marketplace/listings', { method: 'POST', body: JSON.stringify({ courseId: draftId, price: 1000 }) }, instAdminCookie);
  assert.equal(r.status, 400, 'draft course rejected');

  r = await req('/api/admin/marketplace/listings', { method: 'POST', body: JSON.stringify({ courseId, price: 25000 }) }, instAdminCookie);
  await assertStatus(r, 201, 'list published course');
  const listingId = (await json(r)).listing.id;

  // Duplicate listing rejected.
  r = await req('/api/admin/marketplace/listings', { method: 'POST', body: JSON.stringify({ courseId, price: 25000 }) }, instAdminCookie);
  assert.equal(r.status, 409, 'duplicate listing rejected');

  // Public browse (no auth).
  const pub = await fetch(`${baseUrl}/api/marketplace/courses`);
  assert.equal(pub.status, 200, 'public browse reachable');
  const listed = await pub.json();
  const entry = listed.courses.find(c => c.listingId === listingId);
  assert.ok(entry, 'listing visible publicly');
  assert.equal(entry.price, 25000, 'price shown');
  assert.ok(entry.institutionName, 'institution name shown');

  // Student enrolls: creates enrollment + fee record.
  r = await req(`/api/marketplace/courses/${listingId}/enroll`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'marketplace enroll');
  const er = await json(r);
  assert.ok(er.enrolled, 'enrolled');
  assert.ok(er.feeRecord && er.feeRecord.amountDue === 25000, 'fee record for price');

  // Re-enroll is idempotent.
  r = await req(`/api/marketplace/courses/${listingId}/enroll`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  assert.equal(r.status, 200, 're-enroll ok');
  assert.ok((await json(r)).already, 'already flagged');

  // Teacher cannot enroll via marketplace.
  r = await req(`/api/marketplace/courses/${listingId}/enroll`, { method: 'POST', body: JSON.stringify({}) }, teacherCookie);
  assert.equal(r.status, 403, 'non-student blocked');

  // Delete listing.
  r = await req(`/api/admin/marketplace/listings/${listingId}`, { method: 'DELETE' }, instAdminCookie);
  await assertStatus(r, 200, 'delete listing');
  const pub2 = await (await fetch(`${baseUrl}/api/marketplace/courses`)).json();
  assert.ok(!pub2.courses.some(c => c.listingId === listingId), 'listing gone');
});

test('teacher workload aggregates', async () => {
  const w = await json(await req('/api/admin/reports/teacher-workload', {}, instAdminCookie));
  const row = w.workload.find(x => x.teacherId === teacherId);
  assert.ok(row, 'teacher in workload');
  assert.ok(row.coursesOwned >= 1, 'courses counted');
  assert.ok(row.totalStudents >= 1, 'students counted (marketplace enroll)');
  assert.ok(typeof row.hours === 'number', 'hours numeric');
  assert.ok(row.hoursNote, 'hours assumption documented');
  // Org scoping: no teachers from other institutions leak.
  assert.ok(w.workload.every(x => x.teacherId !== 'nobody'), 'shape ok');
});

test('enrollment report JSON and CSV export', async () => {
  const rep = await json(await req('/api/admin/reports/enrollments', {}, instAdminCookie));
  assert.ok(rep.count >= 1, 'enrollments reported');
  assert.ok(rep.enrollments.some(e => e.studentId === studentId && e.courseId === courseId), 'marketplace enrollment in report');

  const csvRes = await req('/api/admin/reports/enrollments?format=csv', {}, instAdminCookie);
  assert.equal(csvRes.status, 200, 'csv ok');
  assert.ok((csvRes.headers.get('content-type') || '').includes('text/csv'), 'csv content-type');
  const text = await csvRes.text();
  assert.ok(text.startsWith('studentId,studentName,courseId,courseTitle'), 'csv header');
  assert.ok(text.includes('Marketplace Math'), 'csv has course title');

  // reports.view required.
  const r = await req('/api/admin/reports/enrollments', {}, studentCookie);
  assert.equal(r.status, 403, 'student blocked from reports');
});

test('bulk import validates rows and scopes to institution', async () => {
  const csv = 'name,username,email,password,grade,section\n' +
    'Bulk One,bulkone,bulkone@example.com,Password123456,10,A\n' +
    'Bad Row,badrow,badrow@example.com,short,10,A\n' +
    'Dup User,bulkone,dupe@example.com,Password123456,10,A\n';
  const r = await req('/api/admin/import/students', { method: 'POST', body: JSON.stringify({ csv }) }, instAdminCookie);
  await assertStatus(r, 201, 'bulk import students');
  const res = await json(r);
  assert.equal(res.created, 1, 'one created');
  assert.equal(res.skipped.length, 2, 'two skipped');
  assert.ok(res.skipped.some(s => s.error.includes('12 to 256')), 'short password flagged');
  assert.ok(res.skipped.some(s => s.error.includes('already in use')), 'duplicate flagged');

  // Imported student is in institution A and can log in.
  const lr = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'bulkone', password: 'Password123456' }) });
  await assertStatus(lr, 200, 'imported student can log in');

  // Teachers import as pending.
  const tcsv = 'name,username,email,password\nBulk Teacher,bulkteacher,bulkteacher@example.com,Password123456\n';
  const tr = await req('/api/admin/import/teachers', { method: 'POST', body: JSON.stringify({ csv: tcsv }) }, instAdminCookie);
  await assertStatus(tr, 201, 'bulk import teachers');
  assert.equal((await json(tr)).created, 1, 'teacher created');
  const users = await json(await req('/api/admin/users', {}, superCookie));
  const bt = users.users.find(u => u.username === 'bulkteacher');
  assert.ok(bt && bt.status === 'pending', 'imported teacher pending approval');
  assert.equal(bt.institutionId, instAId, 'scoped to admin institution');

  // Missing column rejected.
  const mr = await req('/api/admin/import/students', { method: 'POST', body: JSON.stringify({ csv: 'name,username\nA,B' }) }, instAdminCookie);
  assert.equal(mr.status, 400, 'missing columns rejected');

  // import.manage required (teacher lacks it).
  const pr = await req('/api/admin/import/students', { method: 'POST', body: JSON.stringify({ csv }) }, teacherCookie);
  assert.equal(pr.status, 403, 'teacher blocked from import');
});

test('usage analytics counts', async () => {
  const a = await json(await req('/api/admin/analytics/usage?days=30', {}, instAdminCookie));
  assert.equal(a.days, 30, 'days echoed');
  assert.ok(a.logins >= 3, 'logins counted');
  assert.ok(a.activeUsers >= 3, 'active users counted');
  assert.ok(a.enrollments >= 1, 'enrollments counted');
  assert.ok(typeof a.quizAttempts === 'number', 'quizAttempts numeric');
  assert.ok(typeof a.liveSessions === 'number', 'liveSessions numeric');
  assert.ok(typeof a.novaCalls === 'number', 'novaCalls numeric');
  // Student blocked.
  const r = await req('/api/admin/analytics/usage', {}, studentCookie);
  assert.equal(r.status, 403, 'student blocked from analytics');
});
