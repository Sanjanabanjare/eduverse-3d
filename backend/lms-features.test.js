'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl;
let serverProcess;
let tempDir;
let studentCookie;
let teacherCookie;
let adminCookie;
let courseId;
let paidCourseId;
let lessonId;
let quizId;
let q1, q2, q3;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error('Test API server exited before becoming ready.');
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test API server did not become ready within 15 seconds.');
}

async function requestAs(url, options, sessionCookie) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options?.headers || {}), 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}) } });
}

async function signupAndLogin(name, username, password, role) {
  const signup = await requestAs('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, username, password, role, termsAccepted: true, otpVerified: true, otpCode: '123456' }),
  });
  assert.equal(signup.status, 201, `signup failed for ${username}: ${await signup.text()}`);
  const login = await requestAs('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: username, password }),
  });
  assert.equal(login.status, 200, `login failed for ${username}: ${await login.text()}`);
  return login.headers.get('set-cookie').split(';')[0];
}

async function asStudent(url, options) { return requestAs(url, options, studentCookie); }
async function asTeacher(url, options) { return requestAs(url, options, teacherCookie); }
async function asAdmin(url, options) { return requestAs(url, options, adminCookie); }
async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 200)}`); }
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-lms-features-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [], settings: { requireTeacherApproval: false } }));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', EDUVERSE_BOOTSTRAP_ADMIN_EMAIL: 'lms.admin@example.test', EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD: 'Lms-admin-password-123' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  serverProcess.once('exit', code => { if (code && !serverProcess.startupError) serverProcess.startupError = new Error(stderr); });
  await waitForServer();

  teacherCookie = await signupAndLogin('LMS Teacher', 'lms.teacher', 'Lms-teacher-pass-123', 'teacher');
  studentCookie = await signupAndLogin('LMS Student', 'lms.student', 'Lms-student-pass-123', 'student');
  const adminLogin = await requestAs('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'lms.admin@example.test', password: 'Lms-admin-password-123' }),
  });
  assert.equal(adminLogin.status, 200);
  adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => serverProcess.once('exit', resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('teacher creates a free course with a video lesson and a published quiz', async () => {
  const createCourse = await asTeacher('/api/teacher/courses', {
    method: 'POST', body: JSON.stringify({ title: 'LMS Foundations', description: 'Quiz and video test course' }),
  });
  assert.equal(createCourse.status, 201);
  courseId = (await json(createCourse)).course.id;

  const createModule = await asTeacher(`/api/teacher/courses/${courseId}/modules`, {
    method: 'POST', body: JSON.stringify({ name: 'Module One' }),
  });
  assert.equal(createModule.status, 201);
  const moduleId = (await json(createModule)).module.id;

  const createLesson = await asTeacher(`/api/teacher/courses/${courseId}/modules/${moduleId}/lessons`, {
    method: 'POST', body: JSON.stringify({ title: 'Welcome video', content: 'Intro', videoUrl: 'https://example.com/welcome.mp4', videoDurationSec: 100 }),
  });
  assert.equal(createLesson.status, 201);
  const lesson = (await json(createLesson)).lesson;
  assert.equal(lesson.videoType, 'mp4');
  assert.equal(lesson.videoDurationSec, 100);
  lessonId = lesson.id;

  const publish = await asTeacher(`/api/teacher/courses/${courseId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'published' }),
  });
  assert.equal(publish.status, 200);

  const createQuiz = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({
      courseId, title: 'Foundations Quiz', description: 'First quiz',
      maxAttempts: 3, passingScore: 50, status: 'published',
      questions: [
        { type: 'mcq', prompt: 'What is 2 + 2?', options: ['3', '4', '5'], correctIndex: 1, points: 1 },
        { type: 'truefalse', prompt: 'The sky is blue.', correctBoolean: true, points: 1 },
        { type: 'short', prompt: 'Name a primary color.', acceptedAnswers: ['red', 'blue', 'yellow'], points: 1 },
      ],
    }),
  });
  assert.equal(createQuiz.status, 201);
  const quiz = (await json(createQuiz)).quiz;
  assert.equal(quiz.questions.length, 3);
  assert.equal(quiz.questions[0].correctIndex, 1); // teacher sees answers
  quizId = quiz.id;
  [q1, q2, q3] = quiz.questions;

  const badQuiz = await asTeacher('/api/teacher/quizzes', {
    method: 'POST', body: JSON.stringify({ title: 'Bad', questions: [{ type: 'mcq', prompt: 'x?', options: ['only'], correctIndex: 0 }] }),
  });
  assert.equal(badQuiz.status, 400);
});

test('student quiz payloads never leak correct answers', async () => {
  const enroll = await asStudent(`/api/courses/${courseId}/enroll`, { method: 'POST', body: '{}' });
  assert.equal(enroll.status, 201);

  const list = await asStudent('/api/quizzes');
  assert.equal(list.status, 200);
  const quizzes = (await json(list)).quizzes;
  assert.equal(quizzes.length, 1);
  const leaked = JSON.stringify(quizzes);
  assert.doesNotMatch(leaked, /correctIndex|correctBoolean|acceptedAnswers/);
  assert.equal(quizzes[0].attemptsLeft, 3);

  const single = await asStudent(`/api/quizzes/${quizId}`);
  assert.equal(single.status, 200);
  assert.doesNotMatch(JSON.stringify(await single.text()), /correctIndex|correctBoolean|acceptedAnswers/);

  const draftQuiz = await asTeacher('/api/teacher/quizzes', {
    method: 'POST', body: JSON.stringify({ title: 'Draft Quiz', questions: [{ type: 'short', prompt: 'Draft question?' }] }),
  });
  assert.equal(draftQuiz.status, 201);
  const draftId = (await json(draftQuiz)).quiz.id;
  const draftView = await asStudent(`/api/quizzes/${draftId}`);
  assert.equal(draftView.status, 403);
});

test('quiz take, submit, and teacher grading flow', async () => {
  const start = await asStudent(`/api/quizzes/${quizId}/start`, { method: 'POST', body: '{}' });
  assert.equal(start.status, 201);
  const started = await json(start);
  assert.ok(started.attemptId);
  assert.equal(started.questionCount, 3);
  assert.equal(started.questions.length, 3);
  assert.doesNotMatch(JSON.stringify(started.questions), /correctIndex/);
  const attemptId = started.attemptId;

  const submit = await asStudent(`/api/quizzes/${quizId}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [q1.id]: 1, [q2.id]: true, [q3.id]: 'red' } }),
  });
  assert.equal(submit.status, 200);
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.status, 'submitted'); // short answer awaits manual grading
  assert.equal(attempt.autoScore, 67); // 2 of 3 points
  assert.equal(attempt.late || false, false);

  const teacherAttempts = await asTeacher(`/api/teacher/quizzes/${quizId}/attempts`);
  assert.equal(teacherAttempts.status, 200);
  const rows = (await json(teacherAttempts)).attempts;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answers[q3.id], 'red');

  const grade = await asTeacher(`/api/teacher/quiz-attempts/${attemptId}/grade`, {
    method: 'POST', body: JSON.stringify({ grades: { [q3.id]: { points: 1, feedback: 'Correct!' } } }),
  });
  assert.equal(grade.status, 200);
  const graded = (await json(grade)).attempt;
  assert.equal(graded.status, 'graded');
  assert.equal(graded.finalScore, 100);
  assert.equal(graded.passed, true);
  assert.equal(graded.questionGrades[q3.id].feedback, 'Correct!');

  const mine = await asStudent(`/api/quizzes/${quizId}/my-attempts`);
  assert.equal(mine.status, 200);
  assert.equal((await json(mine)).attempts[0].status, 'graded');

  const gam = await asStudent('/api/gamification');
  assert.equal(gam.status, 200);
  const g = await json(gam);
  assert.ok(g.xp >= 60, `expected quiz XP, got ${g.xp}`); // +10 taken, +50 passed
  assert.ok(g.badges.some(b => b.badgeId === 'quiz-master'));
});

test('quiz maxAttempts is enforced', async () => {
  // Attempts 2 and 3: start then submit (resume returns the in-progress attempt instead of creating a new one)
  for (let i = 0; i < 2; i++) {
    const s = await asStudent(`/api/quizzes/${quizId}/start`, { method: 'POST', body: '{}' });
    assert.equal(s.status, 201);
    const { attemptId } = await json(s);
    const sub = await asStudent(`/api/quizzes/${quizId}/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify({ answers: {} }) });
    assert.equal(sub.status, 200);
  }
  const s4 = await asStudent(`/api/quizzes/${quizId}/start`, { method: 'POST', body: '{}' });
  assert.equal(s4.status, 403);
});

test('video progress upserts and auto-completes the lesson at 90 percent', async () => {
  const partial = await asStudent('/api/video/progress', {
    method: 'POST', body: JSON.stringify({ courseId, lessonId, positionSec: 40, watchedSec: 40 }),
  });
  assert.equal(partial.status, 200);
  assert.deepEqual(await json(partial), { saved: true, completed: false, lessonCompleted: false });

  const done = await asStudent('/api/video/progress', {
    method: 'POST', body: JSON.stringify({ courseId, lessonId, positionSec: 95, watchedSec: 95 }),
  });
  assert.equal(done.status, 200);
  assert.deepEqual(await json(done), { saved: true, completed: true, lessonCompleted: true });

  const map = await asStudent(`/api/video/progress?courseId=${courseId}`);
  assert.equal(map.status, 200);
  const progress = (await json(map)).progress;
  assert.equal(progress[lessonId].watchedSec, 95);
  assert.equal(progress[lessonId].completed, true);

  const enrollments = await asStudent('/api/my-enrollments');
  const mine = (await json(enrollments)).enrollments.find(e => e.courseId === courseId);
  assert.equal(mine.completedLessons, 1);

  const gam = await asStudent('/api/gamification');
  const g = await json(gam);
  assert.ok(g.badges.some(b => b.badgeId === 'first-steps'));
});

test('certificate issue requires eligibility, then issues and publicly verifies', async () => {
  // Ineligible course: fresh course with an incomplete lesson
  const c2 = await asTeacher('/api/teacher/courses', {
    method: 'POST', body: JSON.stringify({ title: 'Incomplete Course', description: 'Not finished' }),
  });
  const course2Id = (await json(c2)).course.id;
  const m2 = await asTeacher(`/api/teacher/courses/${course2Id}/modules`, { method: 'POST', body: JSON.stringify({ name: 'Module Two' }) });
  const module2Id = (await json(m2)).module.id;
  await asTeacher(`/api/teacher/courses/${course2Id}/modules/${module2Id}/lessons`, {
    method: 'POST', body: JSON.stringify({ title: 'Unfinished lesson' }),
  });
  await asTeacher(`/api/teacher/courses/${course2Id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
  await asStudent(`/api/courses/${course2Id}/enroll`, { method: 'POST', body: '{}' });

  const denied = await asStudent('/api/certificates/issue', { method: 'POST', body: JSON.stringify({ courseId: course2Id }) });
  assert.equal(denied.status, 400);
  assert.ok(Array.isArray((await json(denied)).missing));

  const issued = await asStudent('/api/certificates/issue', { method: 'POST', body: JSON.stringify({ courseId }) });
  assert.equal(issued.status, 201);
  const cert = (await json(issued)).certificate;
  assert.equal(cert.code.length, 12);
  assert.equal(cert.courseTitle, 'LMS Foundations');
  assert.equal(cert.scoreAvg, 100);

  const mine = await asStudent('/api/certificates');
  assert.equal((await json(mine)).certificates.length, 1);

  const verify = await requestAs(`/api/certificates/verify/${cert.code}`, {});
  assert.equal(verify.status, 200);
  const verified = await json(verify);
  assert.equal(verified.valid, true);
  assert.equal(verified.certificate.userName, 'LMS Student');

  const bogus = await requestAs('/api/certificates/verify/AAAAAAAAAAAA', {});
  assert.equal((await json(bogus)).valid, false);

  const teacherCerts = await asTeacher('/api/teacher/certificates');
  assert.ok((await json(teacherCerts)).certificates.some(c => c.code === cert.code));

  const gam = await asStudent('/api/gamification');
  assert.ok((await json(gam)).badges.some(b => b.badgeId === 'graduate'));
});

test('paid course enrollment is gated until test-mode checkout confirms', async () => {
  const createPaid = await asTeacher('/api/teacher/courses', {
    method: 'POST', body: JSON.stringify({ title: 'Paid Masterclass', description: 'Premium content', priceCents: 50000 }),
  });
  assert.equal(createPaid.status, 201);
  const paidCourse = (await json(createPaid)).course;
  paidCourseId = paidCourse.id;
  assert.equal(paidCourse.priceCents, 50000);
  await asTeacher(`/api/teacher/courses/${paidCourseId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });

  const blocked = await asStudent(`/api/courses/${paidCourseId}/enroll`, { method: 'POST', body: '{}' });
  assert.equal(blocked.status, 402);
  assert.deepEqual((await json(blocked)).checkout, { kind: 'course', courseId: paidCourseId });

  const checkout = await asStudent('/api/checkout', {
    method: 'POST', body: JSON.stringify({ kind: 'course', courseId: paidCourseId }),
  });
  assert.equal(checkout.status, 201);
  const order = (await json(checkout)).order;
  assert.equal(order.status, 'pending');
  assert.equal(order.amountCents, 50000);
  assert.equal(order.testMode, true);

  const confirm = await asStudent(`/api/checkout/${order.id}/confirm`, { method: 'POST', body: '{}' });
  assert.equal(confirm.status, 200);
  assert.equal((await json(confirm)).order.status, 'paid');

  const enrolled = await asStudent(`/api/courses/${paidCourseId}/enroll`, { method: 'POST', body: '{}' });
  assert.equal(enrolled.status, 201);

  const billing = await asStudent('/api/billing');
  assert.ok((await json(billing)).orders.some(o => o.id === order.id && o.status === 'paid'));
});

test('plans, subscriptions, and admin plan management in test mode', async () => {
  const plans = await requestAs('/api/plans', {});
  assert.equal(plans.status, 200);
  const planList = (await json(plans)).plans;
  assert.equal(planList.length, 3);
  const monthly = planList.find(p => p.name === 'Monthly');
  assert.equal(monthly.priceCents, 49900);

  const checkout = await asStudent('/api/checkout', { method: 'POST', body: JSON.stringify({ kind: 'plan', planId: monthly.id }) });
  assert.equal(checkout.status, 201);
  const orderId = (await json(checkout)).order.id;
  const confirm = await asStudent(`/api/checkout/${orderId}/confirm`, { method: 'POST', body: '{}' });
  assert.equal(confirm.status, 200);
  assert.equal((await json(confirm)).subscription.status, 'active');

  const billing = await asStudent('/api/billing');
  const sub = (await json(billing)).subscription;
  assert.ok(sub && sub.endsAt, 'monthly subscription should have an end date');

  const cancel = await asStudent('/api/billing/cancel', { method: 'POST', body: '{}' });
  assert.equal(cancel.status, 200);
  const cancelled = (await json(cancel)).subscription;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.endsAt, sub.endsAt); // stays valid till endsAt

  const adminOrders = await asAdmin('/api/admin/orders');
  assert.ok((await json(adminOrders)).orders.length >= 2);
  const adminSubs = await asAdmin('/api/admin/subscriptions');
  assert.ok((await json(adminSubs)).subscriptions.length >= 1);

  const createPlan = await asAdmin('/api/admin/plans', {
    method: 'POST', body: JSON.stringify({ name: 'Test Plan', priceCents: 1000, interval: 'monthly', features: ['a'] }),
  });
  assert.equal(createPlan.status, 201);
  const planId = (await json(createPlan)).plan.id;
  const patchPlan = await asAdmin(`/api/admin/plans/${planId}`, { method: 'PATCH', body: JSON.stringify({ priceCents: 2000 }) });
  assert.equal((await json(patchPlan)).plan.priceCents, 2000);
  const deletePlan = await asAdmin(`/api/admin/plans/${planId}`, { method: 'DELETE' });
  assert.equal((await json(deletePlan)).plan.active, false);

  const webhook = await requestAs('/api/payments/webhook', { method: 'POST', body: JSON.stringify({ event: 'payment.succeeded' }) });
  assert.equal(webhook.status, 503); // PAYMENTS_WEBHOOK_SECRET not configured in tests
});

test('discussions: thread, reply, pin, and delete', async () => {
  const thread = await asStudent(`/api/courses/${courseId}/discussions`, {
    method: 'POST', body: JSON.stringify({ title: 'Help with lesson one', body: 'I have a question about the video.' }),
  });
  assert.equal(thread.status, 201);
  const threadId = (await json(thread)).discussion.id;

  const list = await asStudent(`/api/courses/${courseId}/discussions`);
  assert.ok((await json(list)).discussions.some(d => d.id === threadId));

  const reply = await asStudent(`/api/discussions/${threadId}/replies`, {
    method: 'POST', body: JSON.stringify({ body: 'Adding more detail here.' }),
  });
  assert.equal(reply.status, 201);
  assert.equal((await json(reply)).discussion.replyCount, 1);

  const view = await asStudent(`/api/discussions/${threadId}`);
  assert.equal((await json(view)).replies.length, 1);

  const pin = await asTeacher(`/api/discussions/${threadId}/pin`, { method: 'POST', body: '{}' });
  assert.equal(pin.status, 200);
  assert.equal((await json(pin)).discussion.pinned, true);

  const secondStudent = await signupAndLogin('Second Student', 'lms.student2', 'Lms-student2-pass-123', 'student');
  const forbidden = await requestAs(`/api/discussions/${threadId}`, { method: 'DELETE' }, secondStudent);
  assert.equal(forbidden.status, 403);

  const removed = await asStudent(`/api/discussions/${threadId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const gone = await asStudent(`/api/discussions/${threadId}`);
  assert.equal(gone.status, 404);
});

test('live sessions: schedule, list, join, and delete', async () => {
  const future = new Date(Date.now() + 3600000).toISOString();
  const created = await asTeacher('/api/teacher/live-sessions', {
    method: 'POST',
    body: JSON.stringify({ courseId, title: 'Live Q&A', description: 'Ask anything', startsAt: future, durationMin: 60, meetingUrl: 'https://meet.example/lms-qa' }),
  });
  assert.equal(created.status, 201);
  const createdSession = (await json(created)).session;
  const sessionId = createdSession.id;
  assert.equal(createdSession.status, 'scheduled');

  const past = await asTeacher('/api/teacher/live-sessions', {
    method: 'POST', body: JSON.stringify({ title: 'Past', startsAt: new Date(Date.now() - 3600000).toISOString(), durationMin: 60, meetingUrl: 'https://meet.example/past' }),
  });
  assert.equal(past.status, 400);
  const badUrl = await asTeacher('/api/teacher/live-sessions', {
    method: 'POST', body: JSON.stringify({ title: 'Bad URL', startsAt: future, durationMin: 60, meetingUrl: 'http://insecure.example/x' }),
  });
  assert.equal(badUrl.status, 400);

  const list = await asStudent('/api/live-sessions');
  assert.equal(list.status, 200);
  const sessions = (await json(list)).sessions;
  const found = sessions.find(s => s.id === sessionId);
  assert.ok(found);
  assert.ok(!('meetingUrl' in found), 'meeting URL is only revealed on join');

  const join = await asStudent(`/api/live-sessions/${sessionId}/join`, { method: 'POST', body: '{}' });
  assert.equal(join.status, 200);
  assert.equal((await json(join)).meetingUrl, 'https://meet.example/lms-qa');

  const teacherJoin = await asTeacher(`/api/live-sessions/${sessionId}/join`, { method: 'POST', body: '{}' });
  assert.equal(teacherJoin.status, 200);
  assert.equal((await json(teacherJoin)).attendees, 2);

  const own = await asTeacher('/api/teacher/live-sessions');
  assert.ok((await json(own)).sessions.some(s => s.id === sessionId));

  const goLive = await asTeacher(`/api/teacher/live-sessions/${sessionId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'live' }),
  });
  assert.equal((await json(goLive)).session.status, 'live');

  const removed = await asTeacher(`/api/teacher/live-sessions/${sessionId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const after = await asStudent('/api/live-sessions');
  assert.ok(!(await json(after)).sessions.some(s => s.id === sessionId));
});

test('gamification profile and leaderboard', async () => {
  const gam = await asStudent('/api/gamification');
  assert.equal(gam.status, 200);
  const g = await json(gam);
  assert.ok(g.xp > 0);
  assert.ok(g.level >= 1);
  assert.ok(g.streakDays >= 1);
  assert.ok(g.nextLevelXp > g.xp);
  assert.ok(Array.isArray(g.badges));
  const badgeIds = g.badges.map(b => b.badgeId);
  for (const expected of ['first-steps', 'quiz-master', 'graduate']) {
    assert.ok(badgeIds.includes(expected), `missing badge ${expected}`);
  }
  assert.ok(g.badges.every(b => b.name && b.awardedAt));

  const board = await asStudent('/api/leaderboard');
  assert.equal(board.status, 200);
  const { leaderboard, rank } = await json(board);
  assert.ok(leaderboard.length >= 2);
  assert.ok(leaderboard.every(e => e.name && typeof e.xp === 'number' && e.level >= 1));
  assert.ok(!leaderboard.some(e => e.name === 'LMS Administrator'));
  assert.ok(rank >= 1);
  for (let i = 1; i < leaderboard.length; i++) {
    assert.ok(leaderboard[i - 1].xp >= leaderboard[i].xp, 'leaderboard must be sorted by XP');
  }
});

test('lessons support kind, quality variants, captions and transcripts', async () => {
  const createCourse = await asTeacher('/api/teacher/courses', {
    method: 'POST', body: JSON.stringify({ title: 'Media Course', description: 'media fields', objectives: 'Watch\nLearn', prerequisites: 'Laptop\nHeadphones' }),
  });
  assert.equal(createCourse.status, 201);
  const course = (await json(createCourse)).course;
  assert.deepEqual(course.prerequisites, ['Laptop', 'Headphones']);

  const createModule = await asTeacher(`/api/teacher/courses/${course.id}/modules`, {
    method: 'POST', body: JSON.stringify({ name: 'Module 1' }),
  });
  assert.equal(createModule.status, 201);
  const moduleId = (await json(createModule)).module.id;
  const lessonUrl = (body) => `/api/teacher/courses/${course.id}/modules/${moduleId}/lessons${body ? '' : ''}`;

  const rich = await asTeacher(lessonUrl(true), {
    method: 'POST', body: JSON.stringify({
      title: 'Rich video', kind: 'video', videoUrl: 'https://example.com/main.mp4', videoDurationSec: 600,
      videoSources: [{ label: '1080p', src: 'https://example.com/hd.mp4' }, { label: '480p', src: 'https://example.com/sd.mp4' }],
      captions: [{ label: 'English', srclang: 'en', src: 'https://example.com/subs-en.vtt' }],
      transcript: '[00:10] Welcome\n[01:00] Main topic',
    }),
  });
  assert.equal(rich.status, 201);
  const rl = (await json(rich)).lesson;
  assert.equal(rl.kind, 'video');
  assert.equal(rl.videoSources.length, 2);
  assert.equal(rl.videoSources[0].label, '1080p');
  assert.equal(rl.captions.length, 1);
  assert.equal(rl.captions[0].srclang, 'en');
  assert.equal(rl.transcript, '[00:10] Welcome\n[01:00] Main topic');

  const badKind = await asTeacher(lessonUrl(true), {
    method: 'POST', body: JSON.stringify({ title: 'Bad kind lesson', kind: 'hologram' }),
  });
  assert.equal(badKind.status, 400);

  const badSrc = await asTeacher(lessonUrl(true), {
    method: 'POST', body: JSON.stringify({ title: 'Bad source lesson', videoSources: [{ label: 'x', src: 'not-a-url' }] }),
  });
  assert.equal(badSrc.status, 400);

  const badCap = await asTeacher(lessonUrl(true), {
    method: 'POST', body: JSON.stringify({ title: 'Bad caption lesson', captions: [{ label: 'x', srclang: 'en', src: 'https://example.com/subs.srt' }] }),
  });
  assert.equal(badCap.status, 400);

  const patch = await asTeacher(`/api/teacher/courses/${course.id}/modules/${moduleId}/lessons/${rl.id}`, {
    method: 'PATCH', body: JSON.stringify({ transcript: 'updated transcript', kind: 'reading' }),
  });
  assert.equal(patch.status, 200);
  const pl = (await json(patch)).lesson;
  assert.equal(pl.transcript, 'updated transcript');
  assert.equal(pl.kind, 'reading');

  const patchBad = await asTeacher(`/api/teacher/courses/${course.id}/modules/${moduleId}/lessons/${rl.id}`, {
    method: 'PATCH', body: JSON.stringify({ kind: 'teleport' }),
  });
  assert.equal(patchBad.status, 400);

  // prerequisites update
  const cp = await asTeacher(`/api/teacher/courses/${course.id}`, {
    method: 'PATCH', body: JSON.stringify({ prerequisites: 'Notebook\nPen' }),
  });
  assert.equal(cp.status, 200);
  assert.deepEqual((await json(cp)).course.prerequisites, ['Notebook', 'Pen']);

  // student sees the new lesson fields on the public course payload
  await asTeacher(`/api/teacher/courses/${course.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
  const enroll = await asStudent(`/api/courses/${course.id}/enroll`, { method: 'POST', body: '{}' });
  assert.equal(enroll.status, 201);
  const list = await asStudent('/api/courses');
  const seen = (await json(list)).courses.find(c => c.id === course.id);
  const seenLesson = seen.modules.flatMap(m => m.lessons || []).find(l => l.id === rl.id);
  assert.ok(seenLesson);
  assert.equal(seenLesson.transcript, 'updated transcript');
  assert.equal(seenLesson.captions.length, 1);
  assert.equal(seenLesson.videoSources.length, 2);
  assert.deepEqual(seen.prerequisites, ['Notebook', 'Pen']);
});

test('final assessment flag is exclusive per course and visible to students', async () => {
  const mk = (title, isFinalAssessment) => asTeacher('/api/teacher/quizzes', {
    method: 'POST', body: JSON.stringify({ courseId, title, isFinalAssessment, status: 'published', questions: [{ type: 'short', prompt: 'Explain.' }] }),
  });
  const f1 = await mk('Final Exam A', true);
  assert.equal(f1.status, 201);
  const f1Body = await json(f1);
  assert.equal(f1Body.quiz.isFinalAssessment, true);
  const f1Id = f1Body.quiz.id;

  const f2 = await mk('Final Exam B', true);
  assert.equal(f2.status, 201);
  assert.equal((await json(f2)).quiz.isFinalAssessment, true);

  const refetch = await asTeacher(`/api/teacher/quizzes/${f1Id}`);
  assert.equal((await json(refetch)).quiz.isFinalAssessment, false);

  const noCourse = await asTeacher('/api/teacher/quizzes', {
    method: 'POST', body: JSON.stringify({ title: 'Orphan Final', isFinalAssessment: true, questions: [{ type: 'short', prompt: 'Q?' }] }),
  });
  assert.equal((await json(noCourse)).quiz.isFinalAssessment, false);

  const list = await asStudent('/api/quizzes');
  const quizzes = (await json(list)).quizzes;
  const finalB = quizzes.find(q => q.title === 'Final Exam B');
  assert.ok(finalB);
  assert.equal(finalB.isFinalAssessment, true);
  assert.doesNotMatch(JSON.stringify(quizzes), /correctIndex|correctBoolean|acceptedAnswers/);
});

test('notes accept video timestamps linked to a lesson', async () => {
  const note = await asStudent('/api/notes', {
    method: 'POST', body: JSON.stringify({ title: 't', content: 'key moment', courseId, lessonId, videoTimestampSec: 95 }),
  });
  assert.equal(note.status, 201);
  const n = (await json(note)).note;
  assert.equal(n.videoTimestampSec, 95);
  assert.equal(n.lessonId, lessonId);
  assert.equal(n.courseId, courseId);

  const plain = await asStudent('/api/notes', {
    method: 'POST', body: JSON.stringify({ title: 'plain', content: 'no timestamp' }),
  });
  assert.equal(plain.status, 201);
  assert.equal((await json(plain)).note.videoTimestampSec, undefined);

  const bad = await asStudent('/api/notes', {
    method: 'POST', body: JSON.stringify({ title: 't', content: 'c', videoTimestampSec: -5 }),
  });
  assert.equal(bad.status, 400);
});
