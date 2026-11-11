'use strict';
/* Slice 5 backend tests: LTI 1.1 launch, SCORM import, xAPI, PDF/XLS exports. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const standards = require('./standards');

let baseUrl, port, serverProcess, tempDir;
let superCookie, teacherCookie, studentCookie;
let courseId, lessonId;

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
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options?.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
}
async function jsonReq(url, options, cookie) {
  return req(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } }, cookie);
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-std-'));
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

  let r = await jsonReq('/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'super login');
  superCookie = cookieOf(r);

  // Teacher (approved) + student.
  r = await jsonReq('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Tia Teacher', email: 'tia@example.com', password: 'Password123456', role: 'teacher' }) }, superCookie);
  await assertStatus(r, 201, 'create teacher');
  const teacherId = (await json(r)).user.id;
  r = await jsonReq('/api/admin/users/' + teacherId, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, superCookie);
  await assertStatus(r, 200, 'approve teacher');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'tia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'teacher login');
  teacherCookie = cookieOf(r);

  r = await jsonReq('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Stu Dent', username: 'stux', password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup');
  r = await jsonReq('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'stux', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login');
  studentCookie = cookieOf(r);

  // Teacher creates a course with a lesson for xAPI emit tests.
  r = await jsonReq('/api/teacher/courses', { method: 'POST', body: JSON.stringify({ title: 'Standards Course', description: 'For LTI/SCORM/xAPI tests' }) }, teacherCookie);
  await assertStatus(r, 201, 'create course');
  courseId = (await json(r)).course.id;
  r = await jsonReq(`/api/teacher/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify({ name: 'Module One' }) }, teacherCookie);
  await assertStatus(r, 201, 'create module');
  const moduleId = (await json(r)).module.id;
  r = await jsonReq(`/api/teacher/courses/${courseId}/modules/${moduleId}/lessons`, { method: 'POST', body: JSON.stringify({ title: 'Lesson One', content: 'Hello' }) }, teacherCookie);
  await assertStatus(r, 201, 'create lesson');
  lessonId = (await json(r)).lesson.id;
  r = await jsonReq(`/api/teacher/courses/${courseId}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, teacherCookie);
  await assertStatus(r, 200, 'publish course');
});

test.after(async () => {
  if (serverProcess) { serverProcess.kill(); await new Promise(r => serverProcess.once('exit', r)); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  // SCORM imports extract to the real uploads dir (store path override doesn't move it).
  await fs.rm(path.join(__dirname, 'uploads', 'scorm'), { recursive: true, force: true }).catch(() => {});
});

/* Build a minimal stored (uncompressed) zip for SCORM import tests. */
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const nameBuf = Buffer.from(f.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 8); // method = stored
    lh.writeUInt32LE(0, 14); // crc (parser does not verify)
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lh, nameBuf, data);
    central.push({ nameBuf, size: data.length, offset });
    offset += 30 + nameBuf.length + data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(c.nameBuf.length, 28);
    ch.writeUInt32LE(c.size, 20);
    ch.writeUInt32LE(c.size, 24);
    ch.writeUInt32LE(c.offset, 42);
    chunks.push(ch, c.nameBuf);
    cdSize += 46 + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

const SAMPLE_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MAN1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <organizations default="ORG1">
    <organization identifier="ORG1"><title>Sample Course</title>
      <item identifier="I1" identifierref="R1"><title>First SCO</title></item>
      <item identifier="I2" identifierref="R2"><title>Second SCO</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="R1" type="webcontent" adlcp:scormtype="sco" href="sco1/index.html"><file href="sco1/index.html"/></resource>
    <resource identifier="R2" type="webcontent" adlcp:scormtype="sco" href="sco2/index.html"><file href="sco2/index.html"/></resource>
  </resources>
</manifest>`;

function sampleZip() {
  return buildZip([
    { name: 'imsmanifest.xml', data: SAMPLE_MANIFEST },
    { name: 'sco1/index.html', data: '<html><body>SCO 1</body></html>' },
    { name: 'sco2/index.html', data: '<html><body>SCO 2</body></html>' },
  ]);
}

test('SCORM manifest parsing (unit)', () => {
  const m = standards.parseScormManifest(SAMPLE_MANIFEST);
  assert.equal(m.title, 'Sample Course');
  assert.equal(m.items.length, 2);
  assert.equal(m.items[0].title, 'First SCO');
  assert.equal(m.items[0].href, 'sco1/index.html');
  assert.ok(m.items[0].sco);
  assert.throws(() => standards.parseScormManifest('<html>nope</html>'), /not a valid SCORM manifest/);
});

test('ZIP parsing rejects unsafe paths', () => {
  const bad = buildZip([{ name: '../evil.txt', data: 'x' }, { name: 'imsmanifest.xml', data: SAMPLE_MANIFEST }]);
  assert.throws(() => standards.parseZip(bad), /unsafe path/);
  assert.throws(() => standards.parseZip(Buffer.from('not a zip')), /Not a (valid )?ZIP/);
});

let ltiKey, ltiSecret;

test('LTI consumer CRUD; secret shown once, never leaked', async () => {
  let r = await jsonReq('/api/admin/lti/consumers', { method: 'POST', body: JSON.stringify({ label: 'Moodle', courseId }) }, superCookie);
  await assertStatus(r, 201, 'create consumer');
  const created = await json(r);
  assert.ok(created.consumer.key);
  assert.ok(created.consumer.secret, 'secret returned on create');
  assert.equal(created.secretShownOnce, true);
  ltiKey = created.consumer.key;
  ltiSecret = created.consumer.secret;

  r = await jsonReq('/api/admin/lti/consumers', {}, superCookie);
  await assertStatus(r, 200, 'list consumers');
  const list = (await json(r)).consumers;
  assert.equal(list.length, 1);
  assert.ok(!('secret' in list[0]), 'GET must never leak the secret');
  assert.equal(list[0].key, ltiKey);

  r = await jsonReq('/api/admin/lti/consumers', { method: 'POST', body: JSON.stringify({ label: 'X', courseId }) }, studentCookie);
  await assertStatus(r, 403, 'student cannot create consumer');

  r = await jsonReq('/api/admin/lti/consumers', { method: 'POST', body: JSON.stringify({ label: 'Bad', courseId: 'nope' }) }, superCookie);
  await assertStatus(r, 400, 'unknown course rejected');
});

function ltiParams(overrides = {}) {
  return {
    lti_message_type: 'basic-lti-launch-request',
    lti_version: 'LTI-1p0',
    oauth_consumer_key: ltiKey,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: 'n' + Math.random().toString(36).slice(2),
    oauth_version: '1.0',
    user_id: 'ext-user-42',
    lis_person_name_full: 'Lti Learner',
    roles: 'Learner',
    ...overrides,
  };
}
function signedLaunch(params) {
  const sig = standards.signOAuth1({ method: 'POST', url: `${baseUrl}/lti/launch`, params, consumerSecret: ltiSecret });
  return { ...params, oauth_signature: sig };
}

test('LTI launch with valid signature provisions user + enrolls', async () => {
  const body = new URLSearchParams(signedLaunch(ltiParams())).toString();
  const r = await req('/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  await assertStatus(r, 302, 'valid launch redirects');
  const ltiCookie = cookieOf(r);
  assert.ok(ltiCookie.includes('eduverse_session'), 'session cookie set');

  const me = await json(await req('/api/auth/me', {}, ltiCookie));
  assert.equal(me.user.username.startsWith('lti_'), true);
  assert.equal(me.user.role, 'student');

  const enr = await json(await req('/api/my-enrollments', {}, ltiCookie));
  assert.ok((enr.enrollments || []).some(e => e.courseId === courseId), 'LTI user enrolled in linked course');
});

test('LTI launch rejects bad signature and replayed nonce', async () => {
  const good = ltiParams();
  const badSig = { ...signedLaunch(good), oauth_signature: 'bogus' };
  let r = await req('/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(badSig).toString(), redirect: 'manual' });
  await assertStatus(r, 401, 'bad signature rejected');

  const once = signedLaunch(ltiParams({ oauth_nonce: 'replay-me' }));
  r = await req('/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(once).toString(), redirect: 'manual' });
  await assertStatus(r, 302, 'first use ok');
  r = await req('/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(once).toString(), redirect: 'manual' });
  await assertStatus(r, 401, 'replayed nonce rejected');

  const stale = signedLaunch(ltiParams({ oauth_timestamp: String(Math.floor(Date.now() / 1000) - 3600) }));
  r = await req('/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(stale).toString(), redirect: 'manual' });
  await assertStatus(r, 401, 'stale timestamp rejected');
});

let scormLessonId;

test('SCORM import creates lessons; bad packages rejected', async () => {
  const zipB64 = sampleZip().toString('base64');
  // Import into the teacher's published course (super_admin has standards.manage).
  let r = await jsonReq('/api/admin/scorm/import', { method: 'POST', body: JSON.stringify({ filename: 'sample.zip', data: zipB64, courseId, title: 'Imported SCORM Course' }) }, superCookie);
  await assertStatus(r, 201, 'import ok');
  const imp = await json(r);
  assert.equal(imp.lessonsCreated, 2);
  assert.equal(imp.courseId, courseId);
  assert.equal(imp.package.items.length, 2);
  assert.ok(!('manifest' in imp.package), 'raw manifest XML not exposed');
  scormLessonId = imp.package.items[0].lessonId;
  assert.ok(scormLessonId);

  // Import without courseId auto-creates a (draft) course.
  r = await jsonReq('/api/admin/scorm/import', { method: 'POST', body: JSON.stringify({ filename: 'auto.zip', data: zipB64 }) }, superCookie);
  await assertStatus(r, 201, 'auto-create course ok');
  assert.ok((await json(r)).courseId);

  // Package files served over /scorm-content/.
  r = await req(`/scorm-content/${imp.package.id}/sco1/index.html`);
  await assertStatus(r, 200, 'SCO file served');
  assert.match(await r.text(), /SCO 1/);

  r = await req(`/scorm-content/${imp.package.id}/..%2f..%2fetc%2fpasswd`);
  assert.ok([400, 404].includes(r.status), 'path traversal blocked');

  r = await jsonReq('/api/scorm/packages', {}, teacherCookie);
  await assertStatus(r, 200, 'teacher lists packages');
  assert.equal((await json(r)).packages.length, 2);

  r = await jsonReq('/api/admin/scorm/import', { method: 'POST', body: JSON.stringify({ filename: 'bad.zip', data: Buffer.from('nope').toString('base64') }) }, superCookie);
  await assertStatus(r, 400, 'bad zip rejected');

  const noManifest = buildZip([{ name: 'readme.txt', data: 'hi' }]).toString('base64');
  r = await jsonReq('/api/admin/scorm/import', { method: 'POST', body: JSON.stringify({ filename: 'noman.zip', data: noManifest }) }, superCookie);
  await assertStatus(r, 400, 'missing manifest rejected');

  r = await jsonReq('/api/admin/scorm/import', { method: 'POST', body: JSON.stringify({ filename: 'x.zip', data: zipB64 }) }, studentCookie);
  await assertStatus(r, 403, 'student cannot import');
});

test('SCORM commit tracks lesson status', async () => {
  // Student enrolls in the teacher's published course (SCORM module was added by import).
  let r = await jsonReq(`/api/courses/${courseId}/enroll`, { method: 'POST', body: '{}' }, studentCookie);
  assert.ok([200, 201].includes(r.status), 'enrolled for SCORM commit');

  r = await jsonReq(`/api/scorm/${scormLessonId}/commit`, { method: 'POST', body: JSON.stringify({ status: 'completed' }) }, studentCookie);
  await assertStatus(r, 200, 'commit ok');
  assert.equal((await json(r)).committed, 'completed');

  r = await jsonReq(`/api/scorm/${scormLessonId}/commit`, { method: 'POST', body: JSON.stringify({ status: 'bogus' }) }, studentCookie);
  await assertStatus(r, 400, 'bad status rejected');

  r = await jsonReq(`/api/scorm/${lessonId}/commit`, { method: 'POST', body: JSON.stringify({ status: 'completed' }) }, studentCookie);
  await assertStatus(r, 404, 'non-SCORM lesson rejected');
});

test('xAPI statements: validate, store, filter', async () => {
  const good = {
    actor: { name: 'Stu Dent', mbox: 'mailto:stu@example.com' },
    verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'experienced' } },
    object: { id: 'eduverse:course:' + courseId, definition: { name: { 'en-US': 'Standards Course' } } },
    result: { completion: true },
  };
  let r = await jsonReq('/api/xapi/statements', { method: 'POST', body: JSON.stringify(good) }, studentCookie);
  await assertStatus(r, 201, 'statement stored');
  const storedId = (await json(r)).id;
  assert.ok(storedId);

  r = await jsonReq('/api/xapi/statements', { method: 'POST', body: JSON.stringify({ actor: { name: 'x' } }) }, studentCookie);
  await assertStatus(r, 400, 'missing verb rejected');
  r = await jsonReq('/api/xapi/statements', { method: 'POST', body: JSON.stringify({ verb: { id: 'not-a-url' }, object: { id: 'y' } }) }, studentCookie);
  await assertStatus(r, 400, 'bad actor/verb rejected');

  r = await jsonReq('/api/admin/xapi/statements?verb=experienced', {}, superCookie);
  await assertStatus(r, 200, 'admin lists statements');
  const list = (await json(r)).statements;
  assert.ok(list.some(s => s.id === storedId), 'stored statement listed');
  assert.ok(list.every(s => String(s.verb.id).toLowerCase().includes('experienced')), 'verb filter applied');

  r = await jsonReq('/api/admin/xapi/statements', {}, studentCookie);
  await assertStatus(r, 403, 'student cannot list statements');
});

test('xAPI internal emit on lesson completion', async () => {
  let r = await jsonReq(`/api/courses/${courseId}/enroll`, { method: 'POST', body: '{}' }, studentCookie);
  assert.ok([200, 201].includes(r.status), 'enrolled');
  r = await jsonReq(`/api/courses/${courseId}/lessons/complete`, { method: 'POST', body: JSON.stringify({ lessonId }) }, studentCookie);
  await assertStatus(r, 200, 'lesson completed');

  r = await jsonReq('/api/admin/xapi/statements?verb=completed', {}, superCookie);
  await assertStatus(r, 200, 'statements listed');
  const stmts = (await json(r)).statements;
  const hit = stmts.find(s => s.object.id === `eduverse:lesson:${lessonId}` && s.verb.id === 'http://adlnet.gov/expapi/verbs/completed');
  assert.ok(hit, 'internal completed statement emitted');
  assert.equal(hit.source, 'internal');
});

test('xAPI internal emit on quiz grading', async () => {
  let r = await jsonReq('/api/teacher/quizzes', {
    method: 'POST',
    body: JSON.stringify({
      courseId, title: 'Auto Quiz', description: 'x', maxAttempts: 1, passingScore: 50, status: 'published',
      questions: [
        { type: 'mcq', prompt: 'What is 2 + 2?', options: ['3', '4', '5'], correctIndex: 1, points: 1 },
        { type: 'truefalse', prompt: 'The sky is blue.', correctBoolean: true, points: 1 },
      ],
    }),
  }, teacherCookie);
  await assertStatus(r, 201, 'quiz created');
  const quiz = (await json(r)).quiz;

  r = await jsonReq(`/api/quizzes/${quiz.id}/start`, { method: 'POST', body: '{}' }, studentCookie);
  await assertStatus(r, 201, 'attempt started');
  const attemptId = (await json(r)).attemptId;
  const answers = {};
  answers[quiz.questions[0].id] = 1;
  answers[quiz.questions[1].id] = true;
  r = await jsonReq(`/api/quizzes/${quiz.id}/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }, studentCookie);
  await assertStatus(r, 200, 'submitted');
  assert.equal((await json(r)).attempt.status, 'graded');

  r = await jsonReq('/api/admin/xapi/statements?verb=passed', {}, superCookie);
  await assertStatus(r, 200, 'statements listed');
  const stmts = (await json(r)).statements;
  const hit = stmts.find(s => s.object.id === `eduverse:quiz:${quiz.id}`);
  assert.ok(hit, 'internal quiz statement emitted');
  assert.equal(hit.verb.id, 'http://adlnet.gov/expapi/verbs/passed');
  assert.equal(hit.result.score.raw, 100);
});

test('enrollment PDF/XLS exports return correct content types', async () => {
  let r = await req('/api/admin/reports/enrollments.pdf', {}, superCookie);
  await assertStatus(r, 200, 'pdf export ok');
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  const html = await r.text();
  assert.match(html, /Enrollment report/);
  assert.match(html, /print/i);

  r = await req('/api/admin/reports/enrollments.xls', {}, superCookie);
  await assertStatus(r, 200, 'xls export ok');
  assert.match(r.headers.get('content-type') || '', /vnd\.ms-excel/);
  const xls = await r.text();
  assert.match(xls, /Workbook/);
  assert.match(xls, /Enrollments/);

  r = await req('/api/admin/reports/enrollments.xls', {}, studentCookie);
  await assertStatus(r, 403, 'student cannot export');
});

test('LTI consumer delete', async () => {
  let r = await jsonReq('/api/admin/lti/consumers', {}, superCookie);
  const id = (await json(r)).consumers[0].id;
  r = await jsonReq(`/api/admin/lti/consumers/${id}`, { method: 'DELETE' }, superCookie);
  await assertStatus(r, 200, 'consumer deleted');
  r = await jsonReq('/api/admin/lti/consumers', {}, superCookie);
  assert.equal((await json(r)).consumers.length, 0);
});
