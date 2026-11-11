'use strict';
/* Slice 4 backend tests: language learning + UI language preference. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, teacherCookie, teacher2Cookie, studentCookie, student2Cookie;
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-lang-'));
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

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

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

  for (const [nm, em, inst] of [['Sam Student', 'sam@example.com', instAId], ['Sue Two', 'sue@example.com', instAId]]) {
    r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: nm, email: em, password: 'Password123456', role: 'student', institutionId: inst }) }, superCookie);
    await assertStatus(r, 201, 'create ' + nm);
    r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: em, password: 'Password123456' }) });
    await assertStatus(r, 200, nm + ' login');
    if (nm === 'Sam Student') studentCookie = cookieOf(r); else student2Cookie = cookieOf(r);
  }
});

test.after(async () => {
  try { serverProcess.kill('SIGTERM'); } catch {}
  try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
});

// ---- Vocab sets ----

test('vocab CRUD is org-scoped and teacher-manageable', async () => {
  // Teacher creates a set via the /api/admin/vocab carve-out.
  let r = await req('/api/admin/vocab', { method: 'POST', body: JSON.stringify({ title: 'Greetings', language: 'Hindi', words: [{ word: 'namaste', meaning: 'hello', example: 'Namaste dost' }] }) }, teacherCookie);
  await assertStatus(r, 201, 'teacher creates vocab set');
  const set = (await json(r)).vocabSet;
  assert.equal(set.institutionId, instAId, 'set lands in teacher institution');
  assert.ok(set.words[0].id, 'words get ids');

  // Validation: word without meaning.
  r = await req('/api/admin/vocab', { method: 'POST', body: JSON.stringify({ title: 'Bad', language: 'Hindi', words: [{ word: 'x' }] }) }, teacherCookie);
  await assertStatus(r, 400, 'word without meaning rejected');

  // Student cannot manage vocab.
  r = await req('/api/admin/vocab', { method: 'POST', body: JSON.stringify({ title: 'Hack', language: 'Hindi', words: [{ word: 'a', meaning: 'b' }] }) }, studentCookie);
  await assertStatus(r, 403, 'student blocked from vocab manage');

  // Institution admin B does not see institution A sets.
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Admin B', email: 'adminb@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'create admin B');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'adminb@example.com', password: 'Password123456' }) });
  const adminBCookie = cookieOf(r);
  r = await req('/api/admin/vocab', {}, adminBCookie);
  const listB = (await json(r)).vocabSets;
  assert.ok(!listB.some(v => v.id === set.id), 'institution B does not see institution A set');

  // Teacher 2 cannot see teacher 1's set in manage view (own-only visibility).
  r = await req('/api/admin/vocab', {}, teacher2Cookie);
  assert.ok(!(await json(r)).vocabSets.some(v => v.id === set.id), 'other teacher does not manage my set');

  // PATCH + DELETE by owner.
  r = await req('/api/admin/vocab/' + set.id, { method: 'PATCH', body: JSON.stringify({ title: 'Greetings Updated' }) }, teacherCookie);
  await assertStatus(r, 200, 'patch vocab set');
  assert.equal((await json(r)).vocabSet.title, 'Greetings Updated');
  r = await req('/api/admin/vocab/' + set.id, { method: 'DELETE' }, teacher2Cookie);
  await assertStatus(r, 404, 'other teacher cannot delete my set');
  r = await req('/api/admin/vocab/' + set.id, { method: 'DELETE' }, teacherCookie);
  await assertStatus(r, 200, 'delete vocab set');
});

test('vocab start/submit grades word-to-meaning answers', async () => {
  let r = await req('/api/admin/vocab', { method: 'POST', body: JSON.stringify({ title: 'Numbers', language: 'Hindi', words: [{ word: 'ek', meaning: 'one' }, { word: 'do', meaning: 'two' }] }) }, teacherCookie);
  await assertStatus(r, 201, 'create numbers set');
  const set = (await json(r)).vocabSet;

  // Student list includes meanings (study material) and attempt info.
  r = await req('/api/vocab', {}, studentCookie);
  await assertStatus(r, 200, 'student vocab list');
  const listed = (await json(r)).vocabSets.find(v => v.id === set.id);
  assert.ok(listed, 'set visible to student');
  assert.equal(listed.words.length, 2, 'meanings included as study material');
  assert.equal(listed.attempts, 0);

  // Start + submit with one correct, one wrong.
  r = await req(`/api/vocab/${set.id}/start`, { method: 'POST' }, studentCookie);
  await assertStatus(r, 201, 'start vocab attempt');
  const start = await json(r);
  assert.ok(start.attemptId, 'attempt id returned');
  const answers = {};
  answers[set.words[0].id] = 'ONE'; // case-insensitive match
  answers[set.words[1].id] = 'three'; // wrong
  r = await req(`/api/vocab/${set.id}/submit`, { method: 'POST', body: JSON.stringify({ attemptId: start.attemptId, answers }) }, studentCookie);
  await assertStatus(r, 200, 'submit vocab attempt');
  const grade = await json(r);
  assert.equal(grade.correct, 1, 'one correct');
  assert.equal(grade.total, 2);
  assert.equal(grade.score, 50);
  assert.equal(grade.passed, false, '50 < 60 pass mark');

  // Best score shows on the list.
  r = await req('/api/vocab', {}, studentCookie);
  const after = (await json(r)).vocabSets.find(v => v.id === set.id);
  assert.equal(after.attempts, 1);
  assert.equal(after.bestScore, 50);

  // Double submit blocked; cross-student blocked.
  r = await req(`/api/vocab/${set.id}/submit`, { method: 'POST', body: JSON.stringify({ attemptId: start.attemptId, answers: {} }) }, studentCookie);
  await assertStatus(r, 400, 'double submit blocked');
  r = await req(`/api/vocab/${set.id}/submit`, { method: 'POST', body: JSON.stringify({ attemptId: start.attemptId, answers: {} }) }, student2Cookie);
  await assertStatus(r, 403, 'cross-student submit blocked');
});

// ---- Speaking ----

test('speaking exercises score word-overlap honestly', async () => {
  let r = await req('/api/admin/speaking', { method: 'POST', body: JSON.stringify({ title: 'Introduce yourself', language: 'English', prompt: 'Say your name and city.', targetPhrase: 'my name is sam and i live in mumbai' }) }, teacherCookie);
  await assertStatus(r, 201, 'create speaking exercise');
  const ex = (await json(r)).exercise;

  // Student cannot manage speaking.
  r = await req('/api/admin/speaking', { method: 'POST', body: JSON.stringify({ title: 'Hack', language: 'English', prompt: 'Say something please.', targetPhrase: 'hi there friend' }) }, studentCookie);
  await assertStatus(r, 403, 'student blocked from speaking manage');

  // Student list includes target phrase (it's the practice goal).
  r = await req('/api/speaking', {}, studentCookie);
  await assertStatus(r, 200, 'student speaking list');
  const listed = (await json(r)).exercises.find(e => e.id === ex.id);
  assert.ok(listed && listed.targetPhrase, 'target phrase visible');

  // Perfect transcript -> 100.
  r = await req(`/api/speaking/${ex.id}/submit`, { method: 'POST', body: JSON.stringify({ transcript: 'My name is Sam and I live in Mumbai!' }) }, studentCookie);
  await assertStatus(r, 200, 'submit speaking');
  const full = await json(r);
  assert.equal(full.score, 100, 'full overlap is 100');
  assert.equal(full.matched, full.total);

  // Partial transcript -> partial score.
  r = await req(`/api/speaking/${ex.id}/submit`, { method: 'POST', body: JSON.stringify({ transcript: 'my name is sam' }) }, studentCookie);
  const part = await json(r);
  assert.equal(part.score, 44, '4 of 9 words = 44%');

  // Empty transcript rejected.
  r = await req(`/api/speaking/${ex.id}/submit`, { method: 'POST', body: JSON.stringify({ transcript: '  ' }) }, studentCookie);
  await assertStatus(r, 400, 'empty transcript rejected');

  // Teacher 2 cannot edit teacher 1's exercise; owner can.
  r = await req('/api/admin/speaking/' + ex.id, { method: 'PATCH', body: JSON.stringify({ title: 'Hijack' }) }, teacher2Cookie);
  await assertStatus(r, 404, 'other teacher cannot edit');
  r = await req('/api/admin/speaking/' + ex.id, { method: 'PATCH', body: JSON.stringify({ title: 'Introduce Yourself v2' }) }, teacherCookie);
  await assertStatus(r, 200, 'owner edits exercise');
  assert.equal((await json(r)).exercise.title, 'Introduce Yourself v2');
});

// ---- UI language preference ----

test('UI language preference persists and validates', async () => {
  let r = await req('/api/profile/language', {}, studentCookie);
  await assertStatus(r, 200, 'get default language');
  assert.equal((await json(r)).lang, 'en', 'default is en');

  r = await req('/api/profile/language', { method: 'POST', body: JSON.stringify({ lang: 'hi' }) }, studentCookie);
  await assertStatus(r, 200, 'set hindi');
  assert.equal((await json(r)).lang, 'hi');

  r = await req('/api/profile/language', {}, studentCookie);
  assert.equal((await json(r)).lang, 'hi', 'persists across reads');

  r = await req('/api/profile/language', { method: 'POST', body: JSON.stringify({ lang: 'xx' }) }, studentCookie);
  await assertStatus(r, 400, 'invalid language rejected');

  r = await req('/api/profile/language', { method: 'POST', body: JSON.stringify({ lang: 'ta' }) }, teacherCookie);
  await assertStatus(r, 200, 'teacher can set language too');
});

// ---- Unit checks for scoring helpers ----

test('lang scoring helpers behave', async () => {
  const lang = require('./lang');
  // Punctuation and case are normalized away.
  const g = lang.gradeVocab({ words: [{ id: 'w1', word: 'x', meaning: 'Good morning!' }] }, { w1: '  good MORNING ' });
  assert.equal(g.score, 100, 'normalized match scores');
  const g2 = lang.gradeVocab({ words: [{ id: 'w1', word: 'x', meaning: 'one' }] }, { w1: 'two' });
  assert.equal(g2.score, 0, 'wrong answer scores 0');
  const s = lang.scoreSpeaking('a b c', 'a b c d');
  assert.equal(s.score, 100, 'extra words do not hurt');
  const s2 = lang.scoreSpeaking('a b c', '');
  assert.equal(s2.score, 0, 'empty transcript is 0');
  assert.ok(!lang.validateUiLang('de'), 'unsupported language rejected');
  assert.equal(lang.validateUiLang('BN'), 'bn', 'case-insensitive language code');
});
