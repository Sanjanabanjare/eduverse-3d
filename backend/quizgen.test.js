'use strict';
/* AI Quiz Generator backend tests: upload/extraction, generation, save, practice, history. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const quizgen = require('./quizgen');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, studentCookie, student2Cookie;

const NOTES = [
  'Photosynthesis is the process by which green plants convert sunlight, water and carbon dioxide into oxygen and glucose.',
  'Chlorophyll is the green pigment inside chloroplasts that captures sunlight for photosynthesis in plant leaves.',
  'The light-dependent reactions of photosynthesis take place in the thylakoid membranes of the chloroplast.',
  'During the Calvin cycle, carbon dioxide is fixed into sugars using energy stored as ATP and NADPH molecules.',
  'Stomata are tiny pores on leaves that open to let carbon dioxide in and close to prevent water loss.',
].join(' ');

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
function makePdf(contentStream, compress) {
  const streamBytes = compress ? zlib.deflateSync(Buffer.from(contentStream, 'utf8')) : Buffer.from(contentStream, 'utf8');
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamBytes.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  const head = Buffer.from('%PDF-1.4\n' + objs.slice(0, 4).join(''), 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\n' + objs[4] + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
  return Buffer.concat([head, streamBytes, tail]);
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-quizgen-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForServer();

  let r = await req('/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'super login');
  superCookie = cookieOf(r);

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Tia Teacher', email: 'tia@example.com', password: 'Password123456', role: 'teacher' }) }, superCookie);
  await assertStatus(r, 201, 'create teacher');
  const tid = (await json(r)).user.id;
  r = await req('/api/admin/users/' + tid, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
  await assertStatus(r, 200, 'approve teacher');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  for (const [nm, em] of [['Sam Student', 'sam@example.com'], ['Sue Two', 'sue@example.com']]) {
    r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: nm, email: em, password: 'Password123456', role: 'student' }) }, superCookie);
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

// ---- PDF / text extraction (unit) ----

test('pdf extraction: flate stream and uncompressed stream', () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Photosynthesis is the process by which green plants convert sunlight into energy.) Tj ET';
  const fromFlate = quizgen.extractPdfText(makePdf(content, true));
  assert.match(fromFlate, /Photosynthesis is the process/);
  const fromPlain = quizgen.extractPdfText(makePdf(content, false));
  assert.match(fromPlain, /Photosynthesis is the process/);
  const empty = quizgen.extractText(Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'), 'application/pdf', 'blank.pdf');
  assert.equal(empty.ok, true);
  assert.equal(empty.text, '');
});

// ---- Upload ----

test('upload TXT and PDF extracts text; bad types rejected', async () => {
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  let r = await req('/api/quizgen/upload', { method: 'POST', body: JSON.stringify({ filename: 'notes.txt', mimeType: 'text/plain', data: b64(NOTES) }) }, studentCookie);
  await assertStatus(r, 200, 'txt upload');
  let d = await json(r);
  assert.equal(d.charCount, NOTES.length);
  assert.match(d.text, /Photosynthesis/);

  const pdf = makePdf('BT /F1 12 Tf 72 720 Td (Chlorophyll captures sunlight inside the chloroplast.) Tj ET', true);
  r = await req('/api/quizgen/upload', { method: 'POST', body: JSON.stringify({ filename: 'notes.pdf', mimeType: 'application/pdf', data: pdf.toString('base64') }) }, teacherCookie);
  await assertStatus(r, 200, 'pdf upload');
  d = await json(r);
  assert.match(d.text, /Chlorophyll captures sunlight/);
  assert.equal(d.kind, 'pdf');

  r = await req('/api/quizgen/upload', { method: 'POST', body: JSON.stringify({ filename: 'img.png', mimeType: 'image/png', data: b64('x') }) }, studentCookie);
  await assertStatus(r, 400, 'unsupported type');

  const blank = makePdf('BT /F1 12 Tf 72 720 Td () Tj ET', false);
  r = await req('/api/quizgen/upload', { method: 'POST', body: JSON.stringify({ filename: 'blank.pdf', mimeType: 'application/pdf', data: blank.toString('base64') }) }, studentCookie);
  await assertStatus(r, 400, 'no readable text');
});

// ---- Generate ----

test('generate from text returns valid MCQs (local provider)', async () => {
  const r = await req('/api/quizgen/generate', { method: 'POST', body: JSON.stringify({ text: NOTES, count: 3 }) }, studentCookie);
  await assertStatus(r, 200, 'generate');
  const d = await json(r);
  assert.equal(d.provider, 'local');
  assert.equal(d.questions.length, 3);
  for (const q of d.questions) {
    assert.ok(q.prompt.length >= 2);
    assert.equal(q.options.length, 4);
    assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4);
  }
  const bad = await req('/api/quizgen/generate', { method: 'POST', body: JSON.stringify({ text: '   ', count: 3 }) }, studentCookie);
  await assertStatus(bad, 400, 'empty text');
});

// ---- Save as a real quiz ----

test('teacher save creates a quiz students can take; validation enforced', async () => {
  const gen = await json(await req('/api/quizgen/generate', { method: 'POST', body: JSON.stringify({ text: NOTES, count: 3 }) }, teacherCookie));
  let r = await req('/api/quizgen/save', { method: 'POST', body: JSON.stringify({ title: 'Photosynthesis quiz', questions: gen.questions }) }, teacherCookie);
  await assertStatus(r, 201, 'save quiz');
  const quiz = (await json(r)).quiz;
  assert.equal(quiz.questions.length, 3);
  assert.equal(quiz.status, 'published');
  assert.equal(quiz.generatedFrom, 'quizgen');

  // Student can list it, view it, and start it.
  r = await req('/api/quizzes', {}, studentCookie);
  await assertStatus(r, 200, 'student quiz list');
  assert.ok((await json(r)).quizzes.some(q => q.id === quiz.id), 'saved quiz listed for student');
  r = await req(`/api/quizzes/${quiz.id}`, {}, studentCookie);
  await assertStatus(r, 200, 'student quiz detail');
  r = await req(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'student starts generated quiz');
  assert.equal((await json(r)).questionCount, 3);

  // Validation: bad questions and bad course.
  r = await req('/api/quizgen/save', { method: 'POST', body: JSON.stringify({ title: 'Bad', questions: [{ prompt: 'x', options: ['a'], correctIndex: 0 }] }) }, teacherCookie);
  await assertStatus(r, 400, 'bad questions rejected');
  r = await req('/api/quizgen/save', { method: 'POST', body: JSON.stringify({ title: 'Bad course', courseId: 'nope', questions: gen.questions }) }, teacherCookie);
  await assertStatus(r, 404, 'bad course rejected');
});

// ---- Permissions ----

test('student cannot save to the shared bank (403)', async () => {
  const gen = await json(await req('/api/quizgen/generate', { method: 'POST', body: JSON.stringify({ text: NOTES, count: 2 }) }, studentCookie));
  const r = await req('/api/quizgen/save', { method: 'POST', body: JSON.stringify({ title: 'Sneaky', questions: gen.questions }) }, studentCookie);
  await assertStatus(r, 403, 'student save blocked');
});

// ---- Practice quizzes ----

test('practice save works and stays private to its owner', async () => {
  const gen = await json(await req('/api/quizgen/generate', { method: 'POST', body: JSON.stringify({ text: NOTES, count: 2 }) }, studentCookie));
  let r = await req('/api/quizgen/save-practice', { method: 'POST', body: JSON.stringify({ title: 'My practice', questions: gen.questions }) }, studentCookie);
  await assertStatus(r, 201, 'practice save');
  const quiz = (await json(r)).quiz;
  assert.equal(quiz.practice, true);
  assert.equal(quiz.status, 'published');

  // Owner can start it.
  r = await req(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: JSON.stringify({}) }, studentCookie);
  await assertStatus(r, 201, 'owner starts practice quiz');

  // Other student: hidden from list, blocked on detail and start.
  r = await req('/api/quizzes', {}, student2Cookie);
  await assertStatus(r, 200, 'other student list');
  assert.ok(!(await json(r)).quizzes.some(q => q.id === quiz.id), 'practice quiz hidden from others');
  r = await req(`/api/quizzes/${quiz.id}`, {}, student2Cookie);
  await assertStatus(r, 403, 'other student detail blocked');
  r = await req(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: JSON.stringify({}) }, student2Cookie);
  await assertStatus(r, 403, 'other student start blocked');
});

// ---- History ----

test('history shows the requester’s own generated quizzes', async () => {
  let r = await req('/api/quizgen/history', {}, teacherCookie);
  await assertStatus(r, 200, 'teacher history');
  let d = await json(r);
  assert.ok(d.history.some(h => h.title === 'Photosynthesis quiz' && h.kind === 'quiz'), 'teacher sees own quiz');

  r = await req('/api/quizgen/history', {}, studentCookie);
  await assertStatus(r, 200, 'student history');
  d = await json(r);
  assert.ok(d.history.some(h => h.title === 'My practice' && h.kind === 'practice'), 'student sees own practice');
  assert.ok(!d.history.some(h => h.title === 'Photosynthesis quiz'), 'student does not see teacher history');
});
