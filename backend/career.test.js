'use strict';
/* Slice 3 backend tests: calendar + career center + placement prep. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, teacherCookie, teacher2Cookie, studentCookie, student2Cookie;
let instAId, instBId, studentId;

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
const futureIso = (days) => new Date(Date.now() + days * 86400000).toISOString();

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-career-'));
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

  // Second institution for org-scoping tests.
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Second College', slug: 'second-college' }) }, superCookie);
  await assertStatus(r, 201, 'create institution B');
  instBId = (await json(r)).institution.id;

  // Institution admin A (has calendar.manage).
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

  // Teachers (approve: admin-created teachers are pending when approval required).
  for (const [nm, em] of [['Tia Teacher', 'tia@example.com'], ['Tom Two', 'tom@example.com']]) {
    r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: nm, email: em, password: 'Password123456', role: 'teacher', institutionId: instAId }) }, superCookie);
    await assertStatus(r, 201, 'create ' + nm);
    const uid = (await json(r)).user.id;
    r = await req('/api/admin/users/' + uid, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
    await assertStatus(r, 200, 'approve ' + nm);
    r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: em, password: 'Password123456' }) });
    await assertStatus(r, 200, nm + ' login');
    if (nm === 'Tia Teacher') teacherCookie = cookieOf(r); else teacher2Cookie = cookieOf(r);
  }

  // Students.
  for (const [nm, em, inst] of [['Sam Student', 'sam@example.com', instAId], ['Sue Two', 'sue@example.com', instAId]]) {
    r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: nm, email: em, password: 'Password123456', role: 'student', institutionId: inst }) }, superCookie);
    await assertStatus(r, 201, 'create ' + nm);
    if (nm === 'Sam Student') studentId = (await json(r)).user.id;
    r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: em, password: 'Password123456' }) });
    await assertStatus(r, 200, nm + ' login');
    if (nm === 'Sam Student') studentCookie = cookieOf(r); else student2Cookie = cookieOf(r);
  }
});

test.after(async () => {
  try { serverProcess.kill('SIGTERM'); } catch {}
  try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
});

// ---- Calendar ----

test('calendar CRUD is org-scoped and perm-gated', async () => {
  // Institution admin A creates a holiday.
  let r = await req('/api/admin/calendar', { method: 'POST', body: JSON.stringify({ title: 'Diwali Break', kind: 'holiday', startsAt: futureIso(30), description: 'No classes.' }) }, instAdminCookie);
  await assertStatus(r, 201, 'create event');
  const ev = (await json(r)).event;
  assert.equal(ev.institutionId, instAId, 'event lands in admin institution');

  // Student cannot create events.
  r = await req('/api/admin/calendar', { method: 'POST', body: JSON.stringify({ title: 'Hack', kind: 'event', startsAt: futureIso(31) }) }, studentCookie);
  await assertStatus(r, 403, 'student blocked from admin calendar');

  // Validation: bad kind.
  r = await req('/api/admin/calendar', { method: 'POST', body: JSON.stringify({ title: 'Bad', kind: 'party', startsAt: futureIso(31) }) }, instAdminCookie);
  await assertStatus(r, 400, 'bad kind rejected');

  // Super admin sees it; a second-institution admin does not.
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Admin B', email: 'adminb@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'create admin B');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'adminb@example.com', password: 'Password123456' }) });
  const adminBCookie = cookieOf(r);
  r = await req('/api/admin/calendar', {}, adminBCookie);
  const listB = (await json(r)).events;
  assert.ok(!listB.some(e => e.id === ev.id), 'institution B does not see institution A event');
  r = await req('/api/admin/calendar', {}, superCookie);
  const listS = (await json(r)).events;
  assert.ok(listS.some(e => e.id === ev.id), 'super admin sees all');

  // PATCH + DELETE.
  r = await req('/api/admin/calendar/' + ev.id, { method: 'PATCH', body: JSON.stringify({ title: 'Diwali Holiday' }) }, instAdminCookie);
  await assertStatus(r, 200, 'patch event');
  assert.equal((await json(r)).event.title, 'Diwali Holiday');
  r = await req('/api/admin/calendar/' + ev.id, { method: 'DELETE' }, instAdminCookie);
  await assertStatus(r, 200, 'delete event');
});

test('unified calendar merges stored events with derived live sessions', async () => {
  // Stored event.
  let r = await req('/api/admin/calendar', { method: 'POST', body: JSON.stringify({ title: 'Annual Day', kind: 'event', startsAt: futureIso(20) }) }, instAdminCookie);
  await assertStatus(r, 201, 'create annual day');
  // Live session (courseless -> open to all students).
  r = await req('/api/teacher/live-sessions', { method: 'POST', body: JSON.stringify({ title: 'Doubt Hour', startsAt: futureIso(21), durationMin: 60, meetingUrl: 'https://meet.example.com/x' }) }, teacherCookie);
  await assertStatus(r, 201, 'create live session');
  r = await req('/api/calendar', {}, studentCookie);
  await assertStatus(r, 200, 'unified calendar');
  const events = (await json(r)).events;
  assert.ok(events.some(e => e.title === 'Annual Day' && e.source === 'stored'), 'stored event present');
  const derived = events.find(e => e.title === 'Doubt Hour');
  assert.ok(derived, 'derived live session present');
  assert.equal(derived.source, 'live');
  assert.ok(derived.endsAt, 'derived event has endsAt');
  // Kind filter + date filter on admin list.
  r = await req('/api/admin/calendar?kind=event', {}, instAdminCookie);
  const filtered = (await json(r)).events;
  assert.ok(filtered.every(e => e.kind === 'event'), 'kind filter works');
});

// ---- Career paths ----

test('career path CRUD is org-scoped', async () => {
  let r = await req('/api/admin/career-paths', { method: 'POST', body: JSON.stringify({ title: 'Data Science', description: 'From stats to ML.', skills: ['Python', 'SQL'] }) }, instAdminCookie);
  await assertStatus(r, 201, 'create career path');
  const cp = (await json(r)).careerPath;
  assert.equal(cp.institutionId, instAId);
  // Student sees it via the public endpoint.
  r = await req('/api/career-paths', {}, studentCookie);
  await assertStatus(r, 200, 'student career paths');
  assert.ok((await json(r)).careerPaths.some(p => p.id === cp.id), 'student sees path');
  // Student cannot manage.
  r = await req('/api/admin/career-paths', { method: 'POST', body: JSON.stringify({ title: 'Hack' }) }, studentCookie);
  await assertStatus(r, 403, 'student blocked from career path management');
  // Unknown course id rejected.
  r = await req('/api/admin/career-paths', { method: 'POST', body: JSON.stringify({ title: 'Bad Path', courses: ['nope'] }) }, instAdminCookie);
  await assertStatus(r, 400, 'unknown course rejected');
  r = await req('/api/admin/career-paths/' + cp.id, { method: 'DELETE' }, instAdminCookie);
  await assertStatus(r, 200, 'delete career path');
});

// ---- Internships ----

test('internship apply is idempotent and deadline-gated', async () => {
  let r = await req('/api/admin/internships', { method: 'POST', body: JSON.stringify({ company: 'Acme Labs', role: 'Frontend Intern', description: 'Build cool UIs.', location: 'Remote', stipend: '₹20k/mo', deadline: futureIso(10) }) }, instAdminCookie);
  await assertStatus(r, 201, 'post internship');
  const ins = (await json(r)).internship;
  assert.equal(ins.applicationCount, 0);
  // Apply twice: idempotent.
  r = await req('/api/internships/' + ins.id + '/apply', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'first apply');
  assert.equal((await json(r)).alreadyApplied, false);
  r = await req('/api/internships/' + ins.id + '/apply', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'second apply');
  const second = await json(r);
  assert.equal(second.alreadyApplied, true, 'second apply is a no-op');
  r = await req('/api/internships', {}, studentCookie);
  const mine = (await json(r)).internships.find(i => i.id === ins.id);
  assert.equal(mine.appliedByMe, true, 'appliedByMe flag set');
  assert.equal(mine.applicationCount, 1, 'only one application recorded');
  assert.ok(!('applications' in mine) || mine.applications === undefined, 'application list not leaked to students');
  // Past deadline blocked.
  r = await req('/api/admin/internships', { method: 'POST', body: JSON.stringify({ company: 'Old Corp', role: 'Stale Role', deadline: new Date(Date.now() - 86400000).toISOString() }) }, instAdminCookie);
  await assertStatus(r, 201, 'post expired internship');
  const staleId = (await json(r)).internship.id;
  r = await req('/api/internships/' + staleId + '/apply', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 400, 'expired deadline blocked');
});

// ---- Aptitude tests ----

test('aptitude answers never leak; start/submit flow works', async () => {
  const questions = [
    { q: 'What is 2 + 2?', choices: ['3', '4', '5'], answer: 1 },
    { q: 'Capital of France?', choices: ['Berlin', 'Paris', 'Rome'], answer: 1 },
  ];
  let r = await req('/api/teacher/aptitude', { method: 'POST', body: JSON.stringify({ title: 'General Aptitude', questions, timeMin: 20 }) }, teacherCookie);
  await assertStatus(r, 201, 'create aptitude test');
  const t = (await json(r)).test;
  assert.equal(t.questionCount, 2);

  // Teacher (non-creator) cannot see another teacher's test.
  r = await req('/api/teacher/aptitude', {}, teacher2Cookie);
  await assertStatus(r, 200, 'teacher2 list');
  assert.ok(!(await json(r)).tests.some(x => x.id === t.id), 'non-creator teacher blocked');

  // Student list has no answers anywhere.
  r = await req('/api/aptitude', {}, studentCookie);
  await assertStatus(r, 200, 'student aptitude list');
  const listed = (await json(r)).tests.find(x => x.id === t.id);
  assert.ok(listed, 'student sees test');
  const listedStr = JSON.stringify(listed);
  assert.ok(!listedStr.includes('"answer"'), 'no answer key in list');

  // Start: questions without answers.
  r = await req('/api/aptitude/' + t.id + '/start', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'start attempt');
  const started = await json(r);
  assert.equal(started.questions.length, 2);
  assert.ok(started.questions.every(q => !('answer' in q)), 'no answer key in start payload');
  const qids = started.questions.map(q => q.id);

  // Resume returns same attempt.
  r = await req('/api/aptitude/' + t.id + '/start', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'resume attempt');
  assert.equal((await json(r)).attemptId, started.attemptId, 'resumed same attempt');

  // Submit with one right, one wrong.
  const answers = {};
  answers[qids[0]] = 1; answers[qids[1]] = 0;
  r = await req('/api/aptitude/' + t.id + '/submit', { method: 'POST', body: JSON.stringify({ attemptId: started.attemptId, answers }) }, studentCookie);
  await assertStatus(r, 200, 'submit attempt');
  const graded = await json(r);
  assert.equal(graded.score, 50);
  assert.equal(graded.correct, 1);
  assert.equal(graded.total, 2);
  assert.equal(graded.passed, true);

  // Double submit blocked.
  r = await req('/api/aptitude/' + t.id + '/submit', { method: 'POST', body: JSON.stringify({ attemptId: started.attemptId, answers }) }, studentCookie);
  await assertStatus(r, 400, 'double submit blocked');

  // Another student cannot submit my attempt.
  r = await req('/api/aptitude/' + t.id + '/start', { method: 'POST', body: JSON.stringify({}) }, student2Cookie);
  const otherAttempt = (await json(r)).attemptId;
  r = await req('/api/aptitude/' + t.id + '/submit', { method: 'POST', body: JSON.stringify({ attemptId: otherAttempt, answers }) }, studentCookie);
  await assertStatus(r, 403, 'cross-student submit blocked');
});

// ---- Mock interviews ----

test('mock interview book -> feedback flow', async () => {
  let r = await req('/api/teacher/mock-interviews', { method: 'POST', body: JSON.stringify({ title: 'HR Round Practice', kind: 'hr', questions: ['Tell me about yourself.', 'Why this role?'] }) }, teacherCookie);
  await assertStatus(r, 201, 'create mock interview');
  const m = (await json(r)).interview;
  assert.equal(m.status, 'open');

  // Student sees the open slot.
  r = await req('/api/mock-interviews', {}, studentCookie);
  await assertStatus(r, 200, 'student interview list');
  assert.ok((await json(r)).interviews.some(i => i.id === m.id), 'student sees open slot');

  // Book it.
  r = await req('/api/mock-interviews/' + m.id + '/book', { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 200, 'book slot');
  assert.equal((await json(r)).interview.status, 'scheduled');

  // Second student cannot book the scheduled slot.
  r = await req('/api/mock-interviews/' + m.id + '/book', { method: 'POST', body: JSON.stringify({}) }, student2Cookie);
  await assertStatus(r, 409, 'double booking blocked');

  // Teacher feedback completes it.
  r = await req('/api/teacher/mock-interviews/' + m.id + '/feedback', { method: 'POST', body: JSON.stringify({ feedback: 'Confident, work on STAR stories.' }) }, teacherCookie);
  await assertStatus(r, 200, 'feedback');
  assert.equal((await json(r)).interview.status, 'done');

  // Student sees the feedback on their interview.
  r = await req('/api/mock-interviews', {}, studentCookie);
  const done = (await json(r)).interviews.find(i => i.id === m.id);
  assert.equal(done.status, 'done');
  assert.ok(done.feedback.includes('STAR'), 'student sees feedback');

  // A booked-then-cancelled slot returns to open.
  r = await req('/api/teacher/mock-interviews', { method: 'POST', body: JSON.stringify({ title: 'Tech Round', kind: 'technical', questions: ['Explain closures.'] }) }, teacherCookie);
  const m2 = (await json(r)).interview;
  r = await req('/api/mock-interviews/' + m2.id + '/book', { method: 'POST', body: JSON.stringify({}) }, student2Cookie);
  await assertStatus(r, 200, 'student2 books');
  r = await req('/api/mock-interviews/' + m2.id + '/cancel', { method: 'POST', body: JSON.stringify({}) }, student2Cookie);
  await assertStatus(r, 200, 'student2 cancels');
  assert.equal((await json(r)).interview.status, 'open');
});
