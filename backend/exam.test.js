'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { runCodeTests, isAttemptExpired } = require('./exam');

let baseUrl;
let serverProcess;
let tempDir;
let studentCookie;
let teacherCookie;
let adminCookie;
let teacherId;
let studentId;

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
  throw new Error('Server did not start in time.');
}

async function requestAs(urlPath, options = {}, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}${urlPath}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
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
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 300)}`); }
}

const NEW_TYPES = [
  { type: 'multiselect', prompt: 'Which numbers are prime?', options: ['2', '3', '4', '5'], correctIndices: [0, 1, 3], points: 6, difficulty: 'easy', topic: 'math', explanation: '2, 3 and 5 are prime; 4 is not.' },
  { type: 'fillblank', prompt: 'Complete the sentence.', template: 'The capital of France is ___.', blankAnswers: [['Paris']], points: 2, difficulty: 'easy', topic: 'geography' },
  { type: 'match', prompt: 'Match the animal to its sound.', pairs: [{ left: 'Cat', right: 'Meow' }, { left: 'Dog', right: 'Bark' }], points: 4, difficulty: 'medium', topic: 'animals' },
  { type: 'essay', prompt: 'Discuss the causes of the water cycle.', maxWords: 500, points: 10, difficulty: 'hard', topic: 'science', rubric: [{ criterion: 'Clarity', maxPoints: 5 }, { criterion: 'Depth', maxPoints: 5 }] },
  { type: 'code', prompt: 'Write solve(input) that doubles the number.', language: 'javascript', starterCode: 'function solve(input){\n  // your code\n}', testCases: [{ input: '21', expectedOutput: '42', points: 5 }], points: 5, difficulty: 'medium', topic: 'coding' },
];

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-exam-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [], settings: { requireTeacherApproval: false } }));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', EDUVERSE_BOOTSTRAP_ADMIN_EMAIL: 'exam.admin@example.test', EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD: 'Exam-admin-password-123' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  serverProcess.once('exit', code => { if (code && !serverProcess.startupError) serverProcess.startupError = new Error(stderr); });
  await waitForServer();

  teacherCookie = await signupAndLogin('Exam Teacher', 'exam.teacher', 'Exam-teacher-pass-123', 'teacher');
  studentCookie = await signupAndLogin('Exam Student', 'exam.student', 'Exam-student-pass-123', 'student');
  const adminLogin = await requestAs('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: 'exam.admin@example.test', password: 'Exam-admin-password-123' }),
  });
  assert.equal(adminLogin.status, 200);
  adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const users = await json(await asAdmin('/api/admin/users'));
  teacherId = users.users.find(u => u.username === 'exam.teacher').id;
  studentId = users.users.find(u => u.username === 'exam.student').id;
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => serverProcess.once('exit', resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('code sandbox: solve() protocol, timeout, syntax errors, no escapes', async () => {
  const r1 = runCodeTests('function solve(input){ return String(Number(input)*2); }',
    [{ input: '21', expectedOutput: '42', points: 5 }, { input: '4', expectedOutput: '8', points: 5 }]);
  assert.equal(r1.earned, 10);
  assert.equal(r1.total, 10);
  const r2 = runCodeTests('function solve(input){ while(true){} }', [{ input: '1', expectedOutput: '1', points: 5 }]);
  assert.equal(r2.earned, 0);
  assert.match(r2.results[0].error, /Time limit exceeded/);
  const r3 = runCodeTests('function solve(input){ return typeof process + "/" + typeof require; }',
    [{ input: '1', expectedOutput: 'undefined/undefined', points: 5 }]);
  assert.equal(r3.results[0].passed, true);
  const r4 = runCodeTests('function solve(input){ return oops undefined; }', [{ input: '1', expectedOutput: '1', points: 5 }]);
  assert.equal(r4.earned, 0);
  assert.ok(r4.results[0].error);
});

test('isAttemptExpired: limit, grace window, no limit', async () => {
  assert.equal(isAttemptExpired({ timeLimitMin: 1 }, { startedAt: new Date(Date.now() - 120000).toISOString() }), true);
  assert.equal(isAttemptExpired({ timeLimitMin: 1 }, { startedAt: new Date(Date.now() - 70000).toISOString() }), false);
  assert.equal(isAttemptExpired({ timeLimitMin: 0 }, { startedAt: new Date(0).toISOString() }), false);
  assert.equal(isAttemptExpired({}, { startedAt: new Date(0).toISOString() }), false);
});

test('question bank CRUD with filters', async () => {
  const create = await asTeacher('/api/teacher/question-bank', {
    method: 'POST', body: JSON.stringify(NEW_TYPES[0]),
  });
  assert.equal(create.status, 201);
  const entry = (await json(create)).question;
  assert.equal(entry.difficulty, 'easy');
  assert.equal(entry.topic, 'math');
  assert.ok(Array.isArray(entry.tags));

  const bad = await asTeacher('/api/teacher/question-bank', {
    method: 'POST', body: JSON.stringify({ type: 'multiselect', prompt: 'Bad', options: ['a'] }),
  });
  assert.equal(bad.status, 400);

  const list = await asTeacher('/api/teacher/question-bank?difficulty=easy&type=multiselect');
  assert.equal(list.status, 200);
  assert.ok((await json(list)).questions.some(q => q.id === entry.id));

  const patch = await asTeacher(`/api/teacher/question-bank/${entry.id}`, {
    method: 'PATCH', body: JSON.stringify({ topic: 'arithmetic' }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await json(patch)).question.topic, 'arithmetic');

  const del = await asTeacher(`/api/teacher/question-bank/${entry.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const gone = await asTeacher('/api/teacher/question-bank');
  assert.ok(!(await json(gone)).questions.some(q => q.id === entry.id));
});

test('quiz accepts the five new question types with common fields', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Advanced Exam', status: 'published', negativeMarking: 0.25, showSolutions: 'immediate', questions: NEW_TYPES }),
  });
  assert.equal(create.status, 201);
  const quiz = (await json(create)).quiz;
  assert.equal(quiz.questions.length, 5);
  assert.equal(quiz.negativeMarking, 0.25);
  assert.equal(quiz.showSolutions, 'immediate');
  const essay = quiz.questions.find(q => q.type === 'essay');
  assert.equal(essay.rubric.length, 2);
  assert.ok(essay.rubric.every(r => r.id));
  const code = quiz.questions.find(q => q.type === 'code');
  assert.equal(code.testCases.length, 1);
  const ms = quiz.questions.find(q => q.type === 'multiselect');
  assert.equal(ms.difficulty, 'easy');
  // store ids for later tests
  globalThis.__examQuizId = quiz.id;
  globalThis.__examQuestions = quiz.questions;
});

test('invalid new-type questions are rejected', async () => {
  const cases = [
    [{ type: 'multiselect', prompt: 'Q?', options: ['a', 'b'] }], // no correctIndices
    [{ type: 'fillblank', prompt: 'Q?', template: 'No blanks here.', blankAnswers: [] }],
    [{ type: 'fillblank', prompt: 'Q?', template: 'A ___ B ___.', blankAnswers: [[ 'x' ]] }], // count mismatch
    [{ type: 'match', prompt: 'Q?', pairs: [{ left: 'a', right: 'b' }] }], // only 1 pair
    [{ type: 'essay', prompt: 'Q?', maxWords: -1 }],
    [{ type: 'code', prompt: 'Q?', testCases: [] }],
    [{ type: 'mcq', prompt: 'Q?', options: ['a', 'b'], correctIndex: 0, difficulty: 'extreme' }],
  ];
  for (const questions of cases) {
    const r = await asTeacher('/api/teacher/quizzes', { method: 'POST', body: JSON.stringify({ title: 'Bad Exam', questions }) });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(questions[0]).slice(0, 80)}`);
  }
});

test('answer keys never leak to students for new types', async () => {
  const quizId = globalThis.__examQuizId;
  const single = await asStudent(`/api/quizzes/${quizId}`);
  assert.equal(single.status, 200);
  const payload = JSON.stringify(await json(single));
  assert.doesNotMatch(payload, /correctIndices/);
  assert.doesNotMatch(payload, /blankAnswers/);
  assert.doesNotMatch(payload, /"pairs"/);
  assert.doesNotMatch(payload, /expectedOutput/);
  assert.doesNotMatch(payload, /explanation/);
  // match still shows shuffled options without the mapping
  const parsed = JSON.parse(payload);
  const match = parsed.quiz.questions.find(q => q.type === 'match');
  assert.ok(match.lefts.includes('Cat') && match.rights.includes('Meow'));
  const code = parsed.quiz.questions.find(q => q.type === 'code');
  assert.equal(code.testCases.length, 1);
  assert.equal(code.testCases[0].input, '21');
  assert.ok(!('expectedOutput' in code.testCases[0]));

  const start = await asStudent(`/api/quizzes/${quizId}/start`, { method: 'POST', body: '{}' });
  assert.ok([200, 201].includes(start.status));
  const startPayload = JSON.stringify(await json(start));
  assert.doesNotMatch(startPayload, /correctIndices|blankAnswers|"pairs"|expectedOutput|explanation/);
});

test('multiselect partial credit and negative marking math', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Marking Exam', status: 'published', negativeMarking: 0.25, questions: [
        { type: 'mcq', prompt: 'Pick a.', options: ['a', 'b'], correctIndex: 0, points: 4 },
        { type: 'multiselect', prompt: 'Pick all evens.', options: ['2', '3', '4', '6'], correctIndices: [0, 2, 3], points: 6 },
      ],
    }),
  });
  const quiz = (await json(create)).quiz;
  const [mcq, ms] = quiz.questions;
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId } = await json(start);
  // mcq wrong (attempted) -> -1 ; multiselect picks [0,1]: 1 right, 1 wrong -> 0 -> attempted -> -1.5
  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [mcq.id]: 1, [ms.id]: [0, 1] } }),
  });
  assert.equal(submit.status, 200);
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.questionGrades[mcq.id].points, -1);
  assert.equal(attempt.questionGrades[ms.id].points, -1.5);
  assert.equal(attempt.autoScore, 0); // floored at zero
  assert.equal(attempt.autoSubmitted, false);

  // partial credit without negative marking: pick [0,2] -> 2/3 of 6 = 4
  const create2 = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Partial Exam', status: 'published', questions: [
      { type: 'multiselect', prompt: 'Pick all evens.', options: ['2', '3', '4', '6'], correctIndices: [0, 2, 3], points: 6 },
    ] }),
  });
  const quiz2 = (await json(create2)).quiz;
  const start2 = await asStudent(`/api/quizzes/${quiz2.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId: a2 } = await json(start2);
  const submit2 = await asStudent(`/api/quizzes/${quiz2.id}/attempts/${a2}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [quiz2.questions[0].id]: [0, 2] } }),
  });
  const att2 = (await json(submit2)).attempt;
  assert.equal(att2.questionGrades[quiz2.questions[0].id].points, 4);
});

test('fillblank and match grade correctly', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Blanks Exam', status: 'published', questions: [
      { type: 'fillblank', prompt: 'Capitals.', template: 'France: ___, Spain: ___.', blankAnswers: [['Paris'], ['Madrid']], points: 4 },
      { type: 'match', prompt: 'Sounds.', pairs: [{ left: 'Cat', right: 'Meow' }, { left: 'Dog', right: 'Bark' }], points: 4 },
    ] }),
  });
  const quiz = (await json(create)).quiz;
  const [fb, m] = quiz.questions;
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId } = await json(start);
  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [fb.id]: ['paris', 'Barcelona'], [m.id]: ['Meow', 'Bark'] } }),
  });
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.questionGrades[fb.id].points, 2); // case-insensitive, 1 of 2
  assert.equal(attempt.questionGrades[m.id].points, 4); // both pairs
  assert.equal(attempt.status, 'graded');
});

test('code question auto-grades through the sandbox', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Code Exam', status: 'published', questions: [
      { type: 'code', prompt: 'Double it.', language: 'javascript', starterCode: 'function solve(input){}', testCases: [{ input: '21', expectedOutput: '42', points: 5 }], points: 5 },
    ] }),
  });
  const quiz = (await json(create)).quiz;
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId } = await json(start);
  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [quiz.questions[0].id]: 'function solve(input){ return String(Number(input)*2); }' } }),
  });
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.questionGrades[quiz.questions[0].id].points, 5);
  assert.equal(attempt.status, 'graded');

  // wrong code -> 0 with per-case results stored for the teacher
  const start2 = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId: a2 } = await json(start2);
  const submit2 = await asStudent(`/api/quizzes/${quiz.id}/attempts/${a2}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [quiz.questions[0].id]: 'function solve(input){ return "nope"; }' } }),
  });
  const att2 = (await json(submit2)).attempt;
  assert.equal(att2.questionGrades[quiz.questions[0].id].points, 0);
  assert.ok(Array.isArray(att2.questionGrades[quiz.questions[0].id].codeResults));
  assert.ok(!('expectedOutput' in att2.questionGrades[quiz.questions[0].id].codeResults[0])); // no leak in attempt view
  const myAtt = await asStudent(`/api/quizzes/${quiz.id}/my-attempts`);
  assert.doesNotMatch(JSON.stringify(await json(myAtt)), /expectedOutput/);
});

test('essay goes to manual grading; rubric scoring works', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Essay Exam', status: 'published', questions: [
      { type: 'essay', prompt: 'Explain.', maxWords: 100, points: 10, rubric: [{ criterion: 'Clarity', maxPoints: 6 }, { criterion: 'Depth', maxPoints: 4 }] },
    ] }),
  });
  const quiz = (await json(create)).quiz;
  const q = quiz.questions[0];
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId } = await json(start);
  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [q.id]: 'Water evaporates and rains.' } }),
  });
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.status, 'submitted'); // needs manual grading
  assert.equal(attempt.passed, false);

  const grade = await asTeacher(`/api/teacher/quiz-attempts/${attemptId}/grade`, {
    method: 'POST', body: JSON.stringify({ grades: { [q.id]: { rubricScores: { [q.rubric[0].id]: 5, [q.rubric[1].id]: 3 }, feedback: 'Good.' } } }),
  });
  assert.equal(grade.status, 200);
  const graded = (await json(grade)).attempt;
  assert.equal(graded.status, 'graded');
  assert.equal(graded.questionGrades[q.id].points, 8);
  assert.deepEqual(Object.keys(graded.questionGrades[q.id].rubricScores).sort(), q.rubric.map(r => r.id).sort());

  const badRubric = await asTeacher(`/api/teacher/quiz-attempts/${attemptId}/grade`, {
    method: 'POST', body: JSON.stringify({ grades: { [q.id]: { rubricScores: { [q.rubric[0].id]: 99 } } } }),
  });
  assert.equal(badRubric.status, 400);
});

test('randomSelect draws from the bank; bankQuestionIds copy into quiz', async () => {
  for (const bq of NEW_TYPES.slice(0, 3)) {
    const r = await asTeacher('/api/teacher/question-bank', { method: 'POST', body: JSON.stringify(bq) });
    assert.equal(r.status, 201);
  }
  const bank = (await json(await asTeacher('/api/teacher/question-bank'))).questions;
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Random Exam', status: 'published', randomSelect: { count: 2 }, bankQuestionIds: [bank[0].id], questions: [{ type: 'truefalse', prompt: 'Sky is blue.', correctBoolean: true }] }),
  });
  assert.equal(create.status, 201);
  const quiz = (await json(create)).quiz;
  assert.equal(quiz.questions.length, 2); // 1 direct + 1 from bank
  assert.ok(quiz.randomSelect.count === 2);

  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const started = await json(start);
  assert.equal(started.questions.length, 2); // drawn 2 at random
  assert.ok(started.serverNow);
  assert.ok(started.attemptId);
});

test('solutions policy gating', async () => {
  const mk = (title, showSolutions) => asTeacher('/api/teacher/quizzes', {
    method: 'POST', body: JSON.stringify({ title, status: 'published', showSolutions, questions: [{ type: 'mcq', prompt: 'Pick a.', options: ['a', 'b'], correctIndex: 0, explanation: 'Because a.' }] }),
  });
  const take = async (quizId, correct) => {
    const s = await asStudent(`/api/quizzes/${quizId}/start`, { method: 'POST', body: '{}' });
    const { attemptId } = await json(s);
    const quiz = (await json(await asTeacher(`/api/teacher/quizzes/${quizId}`))).quiz;
    await asStudent(`/api/quizzes/${quizId}/attempts/${attemptId}/submit`, {
      method: 'POST', body: JSON.stringify({ answers: { [quiz.questions[0].id]: correct ? 0 : 1 } }),
    });
    return attemptId;
  };
  const qNever = (await json(await mk('Sol Never', 'never'))).quiz;
  const aNever = await take(qNever.id, true);
  assert.equal((await asStudent(`/api/quizzes/${qNever.id}/attempts/${aNever}/solutions`)).status, 403);

  const qAfter = (await json(await mk('Sol After', 'after_pass'))).quiz;
  const aAfterFail = await take(qAfter.id, false);
  assert.equal((await asStudent(`/api/quizzes/${qAfter.id}/attempts/${aAfterFail}/solutions`)).status, 403);
  const aAfterPass = await take(qAfter.id, true);
  const solPass = await asStudent(`/api/quizzes/${qAfter.id}/attempts/${aAfterPass}/solutions`);
  assert.equal(solPass.status, 200);
  const sols = (await json(solPass)).solutions;
  assert.equal(sols[0].explanation, 'Because a.');
  assert.equal(sols[0].correctOption, 0);

  const qImm = (await json(await mk('Sol Imm', 'immediate'))).quiz;
  const aImm = await take(qImm.id, false);
  assert.equal((await asStudent(`/api/quizzes/${qImm.id}/attempts/${aImm}/solutions`)).status, 200);
});

test('adaptive flow steps difficulty up and down', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Adaptive Exam', status: 'published', adaptive: true, questions: [
      { type: 'mcq', prompt: 'Easy Q.', options: ['a', 'b'], correctIndex: 0, difficulty: 'easy' },
      { type: 'mcq', prompt: 'Medium Q.', options: ['a', 'b'], correctIndex: 0, difficulty: 'medium' },
      { type: 'mcq', prompt: 'Hard Q.', options: ['a', 'b'], correctIndex: 0, difficulty: 'hard' },
    ] }),
  });
  const quiz = (await json(create)).quiz;
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const started = await json(start);
  assert.equal(started.adaptive, true);
  assert.equal(started.currentDifficulty, 'medium');

  const next1 = await asStudent(`/api/quizzes/${quiz.id}/attempts/${started.attemptId}/next`);
  const n1 = await json(next1);
  assert.equal(n1.question.difficulty, 'medium');
  // answer correctly -> step up to hard
  const ans1 = await asStudent(`/api/quizzes/${quiz.id}/attempts/${started.attemptId}/answer`, {
    method: 'POST', body: JSON.stringify({ questionId: n1.question.id, answer: 0 }),
  });
  assert.equal((await json(ans1)).currentDifficulty, 'hard');
  const next2 = await asStudent(`/api/quizzes/${quiz.id}/attempts/${started.attemptId}/next`);
  const n2 = await json(next2);
  assert.equal(n2.question.difficulty, 'hard');
  // answer wrong -> step down to medium
  const ans2 = await asStudent(`/api/quizzes/${quiz.id}/attempts/${started.attemptId}/answer`, {
    method: 'POST', body: JSON.stringify({ questionId: n2.question.id, answer: 1 }),
  });
  assert.equal((await json(ans2)).currentDifficulty, 'medium');

  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${started.attemptId}/submit`, { method: 'POST', body: '{}' });
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.status, 'graded');
  assert.equal(attempt.finalScore, 50);
});

test('proctored quiz requires consent; snapshots are capped', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Proctored Exam', status: 'published', proctoring: { enabled: true, snapshotIntervalSec: 30 }, questions: [{ type: 'truefalse', prompt: 'T?', correctBoolean: true }] }),
  });
  const quiz = (await json(create)).quiz;
  const denied = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).proctorConsentRequired, true);

  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: JSON.stringify({ proctorConsent: true }) });
  assert.ok([200, 201].includes(start.status));
  const { attemptId } = await json(start);
  const snap = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/snapshots`, {
    method: 'POST', body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,' + 'a'.repeat(100) }),
  });
  assert.equal(snap.status, 200);
  assert.equal((await json(snap)).snapshots, 1);
  const badSnap = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/snapshots`, {
    method: 'POST', body: JSON.stringify({ dataUrl: 'not-a-data-url' }),
  });
  assert.equal(badSnap.status, 400);
});

test('tab switches are recorded on submit', async () => {
  const create = await asTeacher('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Tab Exam', status: 'published', antiCheat: { detectTabSwitch: true }, questions: [{ type: 'truefalse', prompt: 'T?', correctBoolean: true }] }),
  });
  const quiz = (await json(create)).quiz;
  const start = await asStudent(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' });
  const { attemptId } = await json(start);
  const submit = await asStudent(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [quiz.questions[0].id]: true }, tabSwitches: [{ at: new Date().toISOString() }, { at: new Date().toISOString() }], perQuestionSec: { [quiz.questions[0].id]: 42 } }),
  });
  const attempt = (await json(submit)).attempt;
  assert.equal(attempt.tabSwitches.length, 2);
  assert.equal(attempt.perQuestionSec[quiz.questions[0].id], 42);
  assert.equal(attempt.attemptNumber, 1);
});

test('analytics returns real shapes', async () => {
  const quizId = globalThis.__examQuizId;
  const r = await asTeacher(`/api/teacher/quizzes/${quizId}/analytics`);
  assert.equal(r.status, 200);
  const a = await json(r);
  assert.ok(typeof a.attempts === 'number');
  assert.ok(typeof a.avgScore === 'number');
  assert.ok(typeof a.passRate === 'number');
  assert.equal(a.scoreDistribution.length, 10);
  assert.equal(a.perQuestion.length, 5);
  assert.ok(a.perQuestion.every(q => typeof q.correctRate === 'number' && typeof q.avgPoints === 'number'));
  const other = await asStudent(`/api/teacher/quizzes/${quizId}/analytics`);
  assert.equal(other.status, 403); // students are blocked from teacher routes
});

test('rubric-based assignment grading', async () => {
  const cls = await asAdmin('/api/admin/classes', {
    method: 'POST', body: JSON.stringify({ name: 'Rubric Class', teacherIds: [teacherId], studentIds: [studentId] }),
  });
  assert.equal(cls.status, 201);
  const classId = (await json(cls)).class.id;

  const badRubric = await asTeacher('/api/assignments', {
    method: 'POST', body: JSON.stringify({ title: 'Bad Rubric', description: 'd', classId, rubric: [{ criterion: 'x', maxPoints: 0 }] }),
  });
  assert.equal(badRubric.status, 400);

  const create = await asTeacher('/api/assignments', {
    method: 'POST', body: JSON.stringify({ title: 'Rubric Assignment', description: 'Do it.', classId, rubric: [{ criterion: 'Accuracy', maxPoints: 7 }, { criterion: 'Presentation', maxPoints: 3 }] }),
  });
  assert.equal(create.status, 201);
  const assignment = (await json(create)).assignment;
  assert.equal(assignment.rubric.length, 2);
  assert.ok(assignment.rubric.every(r => r.id));

  const sub = await asStudent(`/api/assignments/${assignment.id}/submit`, {
    method: 'POST', body: JSON.stringify({ submission: 'My work.' }),
  });
  assert.equal(sub.status, 200);

  const grade = await asTeacher(`/api/teacher/grading/${assignment.id}/${studentId}`, {
    method: 'PATCH', body: JSON.stringify({ rubricScores: { [assignment.rubric[0].id]: 6, [assignment.rubric[1].id]: 2 }, feedback: 'Well done.' }),
  });
  assert.equal(grade.status, 200);
  const g = (await json(grade)).grade;
  assert.equal(g.marks, 8);
  assert.equal(g.maxMarks, 10);
  assert.ok(g.rubricScores);

  const over = await asTeacher(`/api/teacher/grading/${assignment.id}/${studentId}`, {
    method: 'PATCH', body: JSON.stringify({ rubricScores: { [assignment.rubric[0].id]: 99 } }),
  });
  assert.equal(over.status, 400);
});
