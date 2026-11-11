'use strict';
/* Coding lab backend tests: local JS execution, Judge0 mapping, projects, challenges, rate limit. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const codelab = require('./codelab');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, teacher2Cookie, studentCookie, student2Cookie, student3Cookie;
let instAId, instBId;

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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-codelab-'));
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
  await assertStatus(r, 201, 'create institution B');
  instBId = (await json(r)).institution.id;

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

  for (const [nm, em] of [['Sam Student', 'sam@example.com'], ['Sue Two', 'sue@example.com'], ['Sid Three', 'sid@example.com']]) {
    r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: nm, email: em, password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
    await assertStatus(r, 201, 'create ' + nm);
    r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: em, password: 'Password123456' }) });
    await assertStatus(r, 200, nm + ' login');
    if (nm === 'Sam Student') studentCookie = cookieOf(r);
    else if (nm === 'Sue Two') student2Cookie = cookieOf(r);
    else student3Cookie = cookieOf(r);
  }
});

test.after(async () => {
  try { serverProcess.kill('SIGTERM'); } catch {}
  try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
});

// ---- Local execution ----

test('local JS run: console.log, solve(), errors, timeout', async () => {
  let r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: "console.log('hi');" }) }, studentCookie);
  await assertStatus(r, 200, 'log run');
  let d = await json(r);
  assert.equal(d.stdout, 'hi');
  assert.equal(d.status, 'ok');
  assert.equal(d.provider, 'local');

  r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: 'function solve(input){ return String(Number(input)*2); }', stdin: '21' }) }, studentCookie);
  await assertStatus(r, 200, 'solve run');
  d = await json(r);
  assert.equal(d.stdout, '42');

  r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: "throw new Error('boom');" }) }, studentCookie);
  await assertStatus(r, 200, 'error run');
  d = await json(r);
  assert.equal(d.status, 'error');
  assert.match(d.stderr, /boom/);

  r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: 'while(true){}' }) }, studentCookie);
  await assertStatus(r, 200, 'timeout run');
  d = await json(r);
  assert.equal(d.status, 'timeout');
});

test('non-JS without Judge0 returns 501; unknown language 400', async () => {
  let r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'python', code: 'print(1)' }) }, studentCookie);
  await assertStatus(r, 501, 'python without Judge0');
  assert.match((await json(r)).error, /JUDGE0_API_URL/);

  r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'cobol', code: 'DISPLAY 1.' }) }, studentCookie);
  await assertStatus(r, 400, 'unknown language');
});

// ---- Projects ----

test('project CRUD enforces ownership', async () => {
  let r = await req('/api/code/projects', { method: 'POST', body: JSON.stringify({ title: 'Hello', language: 'javascript', code: "console.log('hi');" }) }, studentCookie);
  await assertStatus(r, 201, 'create project');
  const proj = (await json(r)).project;
  assert.equal(proj.studentId, (await json(await req('/api/auth/me', {}, studentCookie))).user.id);

  r = await req('/api/code/projects', {}, studentCookie);
  assert.equal((await json(r)).projects.length, 1, 'owner lists own project');

  r = await req('/api/code/projects', {}, student2Cookie);
  assert.equal((await json(r)).projects.length, 0, 'other student sees none');

  r = await req('/api/code/projects/' + proj.id, { method: 'PATCH', body: JSON.stringify({ title: 'Hacked' }) }, student2Cookie);
  await assertStatus(r, 404, 'other student cannot patch');

  r = await req('/api/code/projects/' + proj.id, { method: 'DELETE' }, student2Cookie);
  await assertStatus(r, 404, 'other student cannot delete');

  r = await req('/api/code/projects/' + proj.id, { method: 'PATCH', body: JSON.stringify({ title: 'Hello v2' }) }, studentCookie);
  await assertStatus(r, 200, 'owner patches');
  assert.equal((await json(r)).project.title, 'Hello v2');

  r = await req('/api/code/projects/' + proj.id, { method: 'DELETE' }, studentCookie);
  await assertStatus(r, 200, 'owner deletes');
  r = await req('/api/code/projects', {}, studentCookie);
  assert.equal((await json(r)).projects.length, 0, 'project gone');
});

// ---- Challenges ----

test('challenge create is teacher-only; submit grades per case', async () => {
  // Student cannot create challenges.
  let r = await req('/api/teacher/challenges', { method: 'POST', body: JSON.stringify({ title: 'Hack', description: 'x', language: 'javascript', starterCode: '', testCases: [{ input: '1', expectedOutput: '2' }] }) }, studentCookie);
  await assertStatus(r, 403, 'student blocked from challenge create');

  // Teacher creates a "double the input" challenge.
  r = await req('/api/teacher/challenges', { method: 'POST', body: JSON.stringify({ title: 'Double it', description: 'Return twice the input number.', language: 'javascript', starterCode: 'function solve(input){\n  // your code here\n}', testCases: [{ input: '2', expectedOutput: '4' }, { input: '5', expectedOutput: '10' }] }) }, teacherCookie);
  await assertStatus(r, 201, 'teacher creates challenge');
  const ch = (await json(r)).challenge;
  assert.equal(ch.institutionId, instAId, 'challenge lands in teacher institution');
  assert.equal(ch.testCaseCount, 2);

  // Teacher 2 does not see teacher 1's challenge in manage view.
  r = await req('/api/teacher/challenges', {}, teacher2Cookie);
  assert.ok(!(await json(r)).challenges.some(c => c.id === ch.id), 'other teacher does not manage my challenge');

  // Student list shows test cases (visible by design).
  r = await req('/api/code/challenges', {}, studentCookie);
  const listed = (await json(r)).challenges.find(c => c.id === ch.id);
  assert.ok(listed, 'student sees challenge');
  assert.equal(listed.testCases.length, 2);

  // Correct submission: 2/2.
  r = await req('/api/code/challenges/' + ch.id + '/submit', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: 'function solve(input){ return String(Number(input)*2); }' }) }, studentCookie);
  await assertStatus(r, 200, 'correct submit');
  let d = await json(r);
  assert.equal(d.passed, 2);
  assert.equal(d.total, 2);
  assert.ok(d.results.every(x => x.passed), 'all cases pass');

  // Partial submission: only the first case right.
  r = await req('/api/code/challenges/' + ch.id + '/submit', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: "function solve(input){ return input === '2' ? '4' : '0'; }" }) }, studentCookie);
  await assertStatus(r, 200, 'partial submit');
  d = await json(r);
  assert.equal(d.passed, 1);
  assert.equal(d.total, 2);
  assert.equal(d.results[0].passed, true);
  assert.equal(d.results[1].passed, false);

  // Wrong language for the challenge.
  r = await req('/api/code/challenges/' + ch.id + '/submit', { method: 'POST', body: JSON.stringify({ language: 'python', code: 'print(1)' }) }, studentCookie);
  await assertStatus(r, 400, 'language mismatch rejected');

  // Teacher cannot submit as a student.
  r = await req('/api/code/challenges/' + ch.id + '/submit', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: 'function solve(i){ return i; }' }) }, teacherCookie);
  await assertStatus(r, 403, 'teacher cannot submit');

  // Best score is tracked on the student list.
  r = await req('/api/code/challenges', {}, studentCookie);
  const after = (await json(r)).challenges.find(c => c.id === ch.id);
  assert.equal(after.attempts, 2, 'two attempts recorded');
  assert.equal(after.bestScore, 2, 'best score is 2');

  // PATCH + DELETE by owner; other teacher cannot delete.
  r = await req('/api/teacher/challenges/' + ch.id, { method: 'PATCH', body: JSON.stringify({ title: 'Double it (v2)' }) }, teacherCookie);
  await assertStatus(r, 200, 'owner patches challenge');
  r = await req('/api/teacher/challenges/' + ch.id, { method: 'DELETE' }, teacher2Cookie);
  await assertStatus(r, 404, 'other teacher cannot delete');
  r = await req('/api/teacher/challenges/' + ch.id, { method: 'DELETE' }, teacherCookie);
  await assertStatus(r, 200, 'owner deletes challenge');
});

// ---- Rate limit ----

test('rate limit: 21st run in a minute is rejected', async () => {
  for (let i = 0; i < 20; i++) {
    const r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: '1' }) }, student3Cookie);
    await assertStatus(r, 200, 'run ' + (i + 1) + ' allowed');
  }
  const r = await req('/api/code/run', { method: 'POST', body: JSON.stringify({ language: 'javascript', code: '1' }) }, student3Cookie);
  await assertStatus(r, 429, '21st run rejected');
});

// ---- Judge0 mapping (unit tests with a stubbed fetch) ----

test('Judge0 mapping: accepted, compile error, and grading via stub', async () => {
  const prevUrl = process.env.JUDGE0_API_URL;
  process.env.JUDGE0_API_URL = 'https://judge0.example.test';
  try {
    codelab.setFetch(async () => ({
      ok: true,
      json: async () => ({ token: 't1', stdout: 'hello\n', stderr: '', status: { id: 3, description: 'Accepted' } }),
    }));
    let out = await codelab.runWithJudge0({ language: 'python', code: 'print("hello")', stdin: '' });
    assert.equal(out.status, 'ok');
    assert.equal(out.stdout, 'hello\n');
    assert.equal(out.provider, 'judge0');

    codelab.setFetch(async () => ({
      ok: true,
      json: async () => ({ token: 't2', stdout: '', stderr: '', compile_output: 'error: missing semicolon', status: { id: 6, description: 'Compilation Error' } }),
    }));
    out = await codelab.runWithJudge0({ language: 'java', code: 'bad', stdin: '' });
    assert.equal(out.status, 'error');
    assert.match(out.stderr, /missing semicolon/);

    // runCode routes non-JS through Judge0 when configured.
    codelab.setFetch(async () => ({
      ok: true,
      json: async () => ({ token: 't3', stdout: '1\n', stderr: '', status: { id: 3, description: 'Accepted' } }),
    }));
    const rc = await codelab.runCode({ language: 'python', code: 'print(1)', stdin: '' });
    assert.equal(rc.ok, true);
    assert.equal(rc.stdout, '1\n');

    // gradeChallenge via the Judge0 stub: stdin '2' -> '4' is right, '5' -> '0' is wrong.
    codelab.setFetch(async (url, opts) => {
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ token: 't4', stdout: body.stdin === '2' ? '4\n' : '0\n', stderr: '', status: { id: 3, description: 'Accepted' } }),
      };
    });
    const grade = await codelab.gradeChallenge(
      { testCases: [{ input: '2', expectedOutput: '4' }, { input: '5', expectedOutput: '10' }] },
      'python', 'print(1)',
    );
    assert.equal(grade.passed, 1);
    assert.equal(grade.total, 2);
    assert.equal(grade.results[0].passed, true);
    assert.equal(grade.results[1].passed, false);
  } finally {
    codelab.setFetch(null);
    if (prevUrl === undefined) delete process.env.JUDGE0_API_URL;
    else process.env.JUDGE0_API_URL = prevUrl;
  }
  assert.equal(codelab.isJudge0Configured(), false, 'Judge0 unconfigured without env');
});
