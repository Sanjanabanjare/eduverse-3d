'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

let baseUrl;
let port;
let serverProcess;
let tempDir;
let teacherCookie;
let studentCookie;
let outsiderCookie;
let sessionId;
let courseId;
let draftCourseId;
let draftSessionId;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port: p } = server.address();
  await new Promise(resolve => server.close(resolve));
  return p;
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

async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 200)}`); }
}

function wsConnect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: cookie ? { Cookie: cookie } : {} });
    const timer = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('WS connect timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('unexpected-response', (req, res) => { clearTimeout(timer); reject(Object.assign(new Error('unexpected-response'), { statusCode: res.statusCode })); });
    ws.on('error', (e) => { if (e.message !== 'unexpected-response') { clearTimeout(timer); reject(e); } });
  });
}

function nextMsg(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error('timeout waiting for ' + type)); }, timeoutMs);
    const onMsg = (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (!type || m.type === type) { clearTimeout(timer); ws.off('message', onMsg); resolve(m); }
      } catch {}
    };
    ws.on('message', onMsg);
  });
}

function collect(ws) {
  const box = [];
  ws.on('message', (data) => { try { box.push(JSON.parse(data.toString())); } catch {} });
  return box;
}

async function wsHello(ws, roomId, name) {
  const p = nextMsg(ws, null);
  ws.send(JSON.stringify({ type: 'hello', roomId, name }));
  const m = await p;
  if (m.type === 'error') throw new Error('hello rejected: ' + m.error);
  assert.equal(m.type, 'peers');
  return m;
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-live-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [], settings: { requireTeacherApproval: false } }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  serverProcess.once('exit', code => { if (code && !serverProcess.startupError) serverProcess.startupError = new Error(stderr); });
  await waitForServer();

  teacherCookie = await signupAndLogin('Live Teacher', 'live.teacher', 'Live-teacher-pass-123', 'teacher');
  studentCookie = await signupAndLogin('Live Student', 'live.student', 'Live-student-pass-123', 'student');
  outsiderCookie = await signupAndLogin('Live Outsider', 'live.outsider', 'Live-outsider-pass-123', 'student');

  const course = await requestAs('/api/teacher/courses', {
    method: 'POST', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ title: 'Live Course', description: 'Live classroom test course' }),
  });
  assert.equal(course.status, 201);
  courseId = (await json(course)).course.id;

  const publish = await requestAs(`/api/teacher/courses/${courseId}`, {
    method: 'PATCH', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ status: 'published' }),
  });
  assert.equal(publish.status, 200);

  const enroll = await requestAs(`/api/courses/${courseId}/enroll`, { method: 'POST', headers: { Cookie: studentCookie }, body: '{}' });
  assert.equal(enroll.status, 201);

  const startsAt = new Date(Date.now() + 3600_000).toISOString();
  const created = await requestAs('/api/teacher/live-sessions', {
    method: 'POST', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ title: 'Live Classroom Test', startsAt, durationMin: 60, meetingUrl: 'https://example.com/meet', courseId }),
  });
  assert.equal(created.status, 201);
  sessionId = (await json(created)).session.id;

  const draftCourse = await requestAs('/api/teacher/courses', {
    method: 'POST', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ title: 'Draft Live Course', description: 'draft course for access tests' }),
  });
  assert.equal(draftCourse.status, 201);
  draftCourseId = (await json(draftCourse)).course.id;
  const createdDraft = await requestAs('/api/teacher/live-sessions', {
    method: 'POST', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ title: 'Draft Session', startsAt, durationMin: 60, meetingUrl: 'https://example.com/meet-draft', courseId: draftCourseId }),
  });
  assert.equal(createdDraft.status, 201);
  draftSessionId = (await json(createdDraft)).session.id;
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => serverProcess.once('exit', resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('classroom credentials require membership', async () => {
  const denied = await requestAs(`/api/live-sessions/${draftSessionId}/classroom`, { headers: { Cookie: outsiderCookie } });
  assert.equal(denied.status, 403);

  const anon = await requestAs(`/api/live-sessions/${sessionId}/classroom`, {});
  assert.equal(anon.status, 401);

  const missing = await requestAs('/api/live-sessions/nope/classroom', { headers: { Cookie: teacherCookie } });
  assert.equal(missing.status, 404);

  const okRes = await requestAs(`/api/live-sessions/${sessionId}/classroom`, { headers: { Cookie: studentCookie } });
  assert.equal(okRes.status, 200);
  const creds = await json(okRes);
  assert.equal(creds.roomId, 'live:' + sessionId);
  assert.equal(creds.wsUrl, '/ws');
  assert.ok(Array.isArray(creds.iceServers) && creds.iceServers.length > 0);

  const teacherRes = await requestAs(`/api/live-sessions/${sessionId}/classroom`, { headers: { Cookie: teacherCookie } });
  assert.equal(teacherRes.status, 200);
});

test('WS handshake rejects a bad or missing token', async () => {
  await assert.rejects(wsConnect('eduverse_session=not-a-real-session'), (e) => e.statusCode === 401);
  await assert.rejects(wsConnect(null), (e) => e.statusCode === 401);
});

test('hello/peers flow works between two clients', async () => {
  const roomId = 'live:' + sessionId;
  const teacherWs = await wsConnect(teacherCookie);
  const studentWs = await wsConnect(studentCookie);
  try {
    const tPeers = await wsHello(teacherWs, roomId, 'Teach');
    assert.equal(tPeers.peers.length, 0);
    const teacherId = tPeers.clientId;

    const joinedP = nextMsg(teacherWs, 'peer-joined');
    const sPeers = await wsHello(studentWs, roomId, 'Stud');
    assert.equal(sPeers.peers.length, 1);
    assert.equal(sPeers.peers[0].clientId, teacherId);
    assert.equal(sPeers.peers[0].name, 'Teach');

    const joined = await joinedP;
    assert.equal(joined.clientId, sPeers.clientId);
    assert.equal(joined.name, 'Stud');
  } finally {
    teacherWs.close(); studentWs.close();
  }
});

test('signal messages relay to the right peer only', async () => {
  const roomId = 'live:' + sessionId;
  const teacherWs = await wsConnect(teacherCookie);
  const studentWs = await wsConnect(studentCookie);
  const otherWs = await wsConnect(outsiderCookie);
  try {
    const t = await wsHello(teacherWs, roomId, 'Teach');
    const s = await wsHello(studentWs, roomId, 'Stud');
    await wsHello(otherWs, roomId, 'Out');

    const gotP = nextMsg(studentWs, 'signal');
    teacherWs.send(JSON.stringify({ type: 'signal', to: s.clientId, kind: 'offer', payload: { sdp: 'fake-offer' } }));
    const got = await gotP;
    assert.equal(got.from, t.clientId);
    assert.equal(got.kind, 'offer');
    assert.deepEqual(got.payload, { sdp: 'fake-offer' });

    // unknown peer -> sender gets an error, nobody else gets the signal
    const errP = nextMsg(teacherWs, 'error');
    teacherWs.send(JSON.stringify({ type: 'signal', to: 'nope', kind: 'offer', payload: {} }));
    const err = await errP;
    assert.match(err.error, /Peer not found/);
  } finally {
    teacherWs.close(); studentWs.close(); otherWs.close();
  }
});

test('chat is sanitized and rate-limited', async () => {
  const roomId = 'live:' + sessionId;
  const teacherWs = await wsConnect(teacherCookie);
  const studentWs = await wsConnect(studentCookie);
  try {
    await wsHello(teacherWs, roomId, 'Teach');
    await wsHello(studentWs, roomId, 'Stud');
    const studentBox = collect(studentWs);
    const teacherBox = collect(teacherWs);

    teacherWs.send(JSON.stringify({ type: 'chat', text: '<b>hi</b><script>alert(1)</script>' }));
    const first = await nextMsg(studentWs, 'chat');
    assert.equal(first.text, '&lt;b&gt;hi&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(first.name, 'Teach');

    for (let i = 0; i < 11; i++) teacherWs.send(JSON.stringify({ type: 'chat', text: 'spam ' + i }));
    await new Promise(r => setTimeout(r, 800));
    const rateErrors = teacherBox.filter(m => m.type === 'error' && /rate limit/i.test(m.error));
    assert.ok(rateErrors.length >= 1, 'expected a rate-limit error');
    const studentChats = studentBox.filter(m => m.type === 'chat');
    assert.equal(studentChats.length, 10, `expected 10 delivered chats, got ${studentChats.length}`);
  } finally {
    teacherWs.close(); studentWs.close();
  }
});

test('teacher-only controls are enforced', async () => {
  const roomId = 'live:' + sessionId;
  const teacherWs = await wsConnect(teacherCookie);
  const studentWs = await wsConnect(studentCookie);
  try {
    await wsHello(teacherWs, roomId, 'Teach');
    await wsHello(studentWs, roomId, 'Stud');

    // student tries to start a poll -> error
    const errP = nextMsg(studentWs, 'error');
    studentWs.send(JSON.stringify({ type: 'poll-start', pollId: 'p1', question: 'Q?', options: ['A', 'B'] }));
    const err = await errP;
    assert.match(err.error, /Only the teacher/);

    // teacher starts a poll -> student receives it
    const pollP = nextMsg(studentWs, 'poll-start');
    teacherWs.send(JSON.stringify({ type: 'poll-start', pollId: 'p1', question: 'Q?', options: ['A', 'B'] }));
    const poll = await pollP;
    assert.equal(poll.pollId, 'p1');
    assert.deepEqual(poll.options, ['A', 'B']);

    // student votes -> teacher sees the vote
    const voteP = nextMsg(teacherWs, 'poll-vote');
    studentWs.send(JSON.stringify({ type: 'poll-vote', pollId: 'p1', option: 'A' }));
    const vote = await voteP;
    assert.equal(vote.option, 'A');

    // mute-all from teacher reaches student
    const muteP = nextMsg(studentWs, 'mute-all');
    teacherWs.send(JSON.stringify({ type: 'mute-all' }));
    await muteP;
  } finally {
    teacherWs.close(); studentWs.close();
  }
});

test('classroom end closes the room and marks the session ended', async () => {
  const roomId = 'live:' + sessionId;
  const teacherWs = await wsConnect(teacherCookie);
  const studentWs = await wsConnect(studentCookie);
  try {
    await wsHello(teacherWs, roomId, 'Teach');
    await wsHello(studentWs, roomId, 'Stud');
    const closedT = nextMsg(teacherWs, 'room-closed');
    const closedS = nextMsg(studentWs, 'room-closed');

    const end = await requestAs(`/api/live-sessions/${sessionId}/classroom/end`, { method: 'POST', headers: { Cookie: studentCookie } });
    assert.equal(end.status, 404, 'non-owner cannot end the classroom');

    const endOk = await requestAs(`/api/live-sessions/${sessionId}/classroom/end`, { method: 'POST', headers: { Cookie: teacherCookie } });
    assert.equal(endOk.status, 200);
    assert.equal((await json(endOk)).session.status, 'ended');

    assert.equal((await closedT).roomId, roomId);
    assert.equal((await closedS).roomId, roomId);

    const gone = await requestAs(`/api/live-sessions/${sessionId}/classroom`, { headers: { Cookie: teacherCookie } });
    assert.equal(gone.status, 400);
  } finally {
    try { teacherWs.close(); } catch {}
    try { studentWs.close(); } catch {}
  }
});

test('join records attendance timestamps', async () => {
  // fresh session so the ended one above does not interfere
  const startsAt = new Date(Date.now() + 3600_000).toISOString();
  const created = await requestAs('/api/teacher/live-sessions', {
    method: 'POST', headers: { Cookie: teacherCookie },
    body: JSON.stringify({ title: 'Attendance Test', startsAt, durationMin: 60, meetingUrl: 'https://example.com/meet2', courseId }),
  });
  assert.equal(created.status, 201);
  const sid = (await json(created)).session.id;

  const join = await requestAs(`/api/live-sessions/${sid}/join`, { method: 'POST', headers: { Cookie: studentCookie }, body: '{}' });
  assert.equal(join.status, 200);

  const list = await requestAs('/api/teacher/live-sessions', { headers: { Cookie: teacherCookie } });
  const found = (await json(list)).sessions.find(s => s.id === sid);
  assert.ok(found);
  const entry = (found.attendance || []).find(a => a.userId && a.joinedAt);
  assert.ok(entry, 'expected an attendance entry with joinedAt');
  assert.ok(!Number.isNaN(new Date(entry.joinedAt).getTime()), 'joinedAt must be a valid timestamp');
});
