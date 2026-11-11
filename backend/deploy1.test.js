'use strict';
/* Deploy readiness slice 1 (2026-11-11): session persistence across restarts
 * (store.sessions mirror) and the CODE_EXEC_ENABLED=false kill switch
 * (/api/code/run 503 + exam code questions grade 0 with a disabled note). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, disabledBaseUrl, port, disabledPort;
let mainProcess, disabledProcess, tempDir;
let mainStorePath, disabledStorePath;
let superCookie, teacherCookie, studentCookie, studentId;
let disabledTeacherCookie, disabledStudentCookie;

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
function spawnServer(storePath, p, extraEnv) {
  return spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(p), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', ...(extraEnv || {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}
async function stopServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await new Promise(r => proc.once('exit', r));
}
async function restartMain() {
  await stopServer(mainProcess);
  mainProcess = spawnServer(mainStorePath, port);
  await waitForServer(baseUrl, mainProcess);
}
async function waitFor(label, fn, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for: ${label} (last: ${last instanceof Error ? last.message : last})`);
}
async function readStore(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }
function req(base, url, options, cookie) {
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
const sidOf = cookie => String(cookie || '').split('=')[1];
async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
}
async function loginAs(base, identifier, password) {
  const r = await jsonReq(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
  await assertStatus(r, 200, 'login ' + identifier);
  return cookieOf(r);
}
async function setupServer(base, storePath, p, extraEnv) {
  const proc = spawnServer(storePath, p, extraEnv);
  await waitForServer(base, proc);
  let r = await jsonReq(base, '/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  const rootCookie = await loginAs(base, 'root', 'Password123456');
  r = await jsonReq(base, '/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Tia Teacher', email: 'tia@example.com', password: 'Password123456', role: 'teacher' }) }, rootCookie);
  await assertStatus(r, 201, 'create teacher');
  const teacherId = (await json(r)).user.id;
  r = await jsonReq(base, '/api/admin/users/' + teacherId, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, rootCookie);
  await assertStatus(r, 200, 'approve teacher');
  const tCookie = await loginAs(base, 'tia@example.com', 'Password123456');
  r = await jsonReq(base, '/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Stu Dent', username: 'stux', password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup');
  const sId = (await json(r)).user.id;
  const sCookie = await loginAs(base, 'stux', 'Password123456');
  return { proc, rootCookie, teacherCookie: tCookie, studentCookie: sCookie, studentId: sId };
}
async function createCodeQuiz(base, tCookie, title) {
  const r = await jsonReq(base, '/api/teacher/quizzes', { method: 'POST', body: JSON.stringify({ title, status: 'published', questions: [
    { type: 'code', prompt: 'Double it.', language: 'javascript', starterCode: 'function solve(input){}', testCases: [{ input: '21', expectedOutput: '42', points: 5 }], points: 5 },
  ] }) }, tCookie);
  await assertStatus(r, 201, 'create code quiz ' + title);
  return (await json(r)).quiz;
}
async function submitCodeAttempt(base, sCookie, quiz, code) {
  const start = await jsonReq(base, `/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' }, sCookie);
  await assertStatus(start, 201, 'start attempt');
  const { attemptId } = await json(start);
  const submit = await jsonReq(base, `/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, {
    method: 'POST', body: JSON.stringify({ answers: { [quiz.questions[0].id]: code } }),
  }, sCookie);
  await assertStatus(submit, 200, 'submit attempt');
  return (await json(submit)).attempt;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-deploy1-'));
  mainStorePath = path.join(tempDir, 'store.json');
  disabledStorePath = path.join(tempDir, 'store-disabled.json');
  await fs.writeFile(mainStorePath, JSON.stringify({ users: [], adminAudit: [] }));
  await fs.writeFile(disabledStorePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  disabledPort = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  disabledBaseUrl = `http://127.0.0.1:${disabledPort}`;

  const main = await setupServer(baseUrl, mainStorePath, port);
  mainProcess = main.proc;
  superCookie = main.rootCookie; teacherCookie = main.teacherCookie;
  studentCookie = main.studentCookie; studentId = main.studentId;

  const dis = await setupServer(disabledBaseUrl, disabledStorePath, disabledPort, { CODE_EXEC_ENABLED: 'false' });
  disabledProcess = dis.proc;
  disabledTeacherCookie = dis.teacherCookie; disabledStudentCookie = dis.studentCookie;
});

test.after(async () => {
  await stopServer(mainProcess);
  await stopServer(disabledProcess);
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('sessions survive a server restart on the same store file', async () => {
  const cookie = await loginAs(baseUrl, 'stux', 'Password123456');
  const sid = sidOf(cookie);
  await waitFor('session row in store', async () => {
    const store = await readStore(mainStorePath);
    return (store.sessions || []).some(s => s.id === sid && s.userId === studentId);
  });
  let r = await req(baseUrl, '/api/auth/me', {}, cookie);
  await assertStatus(r, 200, 'me before restart');
  await restartMain();
  r = await req(baseUrl, '/api/auth/me', {}, cookie);
  await assertStatus(r, 200, 'me after restart');
  assert.equal((await json(r)).user.username, 'stux');
});

test('logout invalidates the session even across a restart', async () => {
  const cookie = await loginAs(baseUrl, 'stux', 'Password123456');
  const sid = sidOf(cookie);
  await waitFor('session row in store', async () => {
    const store = await readStore(mainStorePath);
    return (store.sessions || []).some(s => s.id === sid);
  });
  let r = await req(baseUrl, '/api/auth/logout', { method: 'POST', body: '{}' }, cookie);
  await assertStatus(r, 200, 'logout');
  await waitFor('session row removed from store', async () => {
    const store = await readStore(mainStorePath);
    return !(store.sessions || []).some(s => s.id === sid);
  });
  await restartMain();
  r = await req(baseUrl, '/api/auth/me', {}, cookie);
  await assertStatus(r, 401, 'me after logout + restart');
});

test('expired stored sessions are dropped on boot', async () => {
  await stopServer(mainProcess);
  const store = await readStore(mainStorePath);
  store.sessions = store.sessions || [];
  store.sessions.push({ id: 'deadbeef-expired-session', userId: studentId, expiresAt: Date.now() - 1000 });
  await fs.writeFile(mainStorePath, JSON.stringify(store, null, 2));
  mainProcess = spawnServer(mainStorePath, port);
  await waitForServer(baseUrl, mainProcess);
  await waitFor('expired row pruned from store', async () => {
    const after = await readStore(mainStorePath);
    return !(after.sessions || []).some(s => s.id === 'deadbeef-expired-session');
  });
  // A live session still authenticates after the same restart.
  const r = await req(baseUrl, '/api/auth/me', {}, studentCookie);
  await assertStatus(r, 200, 'live session still works after boot prune');
});

test('code run works by default (CODE_EXEC_ENABLED unset)', async () => {
  const r = await jsonReq(baseUrl, '/api/code/run', {
    method: 'POST', body: JSON.stringify({ language: 'javascript', code: "console.log('hello-deploy1')" }),
  }, studentCookie);
  await assertStatus(r, 200, 'code run default');
  assert.match((await json(r)).stdout || '', /hello-deploy1/);
});

test('code exam question grades normally when execution is enabled', async () => {
  const quiz = await createCodeQuiz(baseUrl, teacherCookie, 'Code Exam Enabled');
  const attempt = await submitCodeAttempt(baseUrl, studentCookie, quiz, 'function solve(input){ return String(Number(input)*2); }');
  assert.equal(attempt.status, 'graded');
  assert.equal(attempt.questionGrades[quiz.questions[0].id].points, 5);
});

test('CODE_EXEC_ENABLED=false: /api/code/run 503s after auth', async () => {
  const unauth = await jsonReq(disabledBaseUrl, '/api/code/run', {
    method: 'POST', body: JSON.stringify({ language: 'javascript', code: '1+1' }),
  });
  await assertStatus(unauth, 401, 'code run unauthenticated still 401 first');
  const r = await jsonReq(disabledBaseUrl, '/api/code/run', {
    method: 'POST', body: JSON.stringify({ language: 'javascript', code: '1+1' }),
  }, disabledStudentCookie);
  await assertStatus(r, 503, 'code run disabled');
  assert.equal((await json(r)).error, 'Code execution is disabled on this server.');
});

test('CODE_EXEC_ENABLED=false: code exam question grades 0 with a disabled note', async () => {
  const quiz = await createCodeQuiz(disabledBaseUrl, disabledTeacherCookie, 'Code Exam Disabled');
  // Correct code — it would score 5 if it ran, so 0 proves it did not execute.
  const attempt = await submitCodeAttempt(disabledBaseUrl, disabledStudentCookie, quiz, 'function solve(input){ return String(Number(input)*2); }');
  assert.equal(attempt.status, 'graded');
  const grade = attempt.questionGrades[quiz.questions[0].id];
  assert.equal(grade.points, 0);
  assert.ok(Array.isArray(grade.codeResults));
  assert.match(grade.codeResults[0].error || '', /code execution is disabled/i);
});
