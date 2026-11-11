'use strict';
/* ChatGPT-style Nova chat (2026-11-11, NOVA2_CONTRACT.md): per-user history,
 * local fallback, clear/regenerate, rate limit, and the SSE streaming shape
 * against a stubbed OpenAI server (OPENAI_BASE_URL override). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;

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
function spawnServer(storePath, p, extraEnv = {}) {
  return spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(p), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', OPENAI_API_KEY: '', OPENAI_BASE_URL: '', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}
async function req(base, url, options, cookie) {
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
async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
}
async function createStudent(base, name, username) {
  let r = await jsonReq(base, '/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, username, password: 'Password123456', role: 'student', termsAccepted: true }) });
  await assertStatus(r, 201, 'student signup ' + username);
  const id = (await json(r)).user.id;
  r = await jsonReq(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: username, password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login ' + username);
  return { id, cookie: cookieOf(r) };
}
async function chat(base, cookie, message, extra = {}) {
  const r = await jsonReq(base, '/api/chat', { method: 'POST', body: JSON.stringify({ message, ...extra }) }, cookie);
  return { res: r, body: r.status === 200 ? await json(r) : null };
}
async function history(base, cookie) {
  const r = await req(base, '/api/chat/history', {}, cookie);
  await assertStatus(r, 200, 'chat history');
  return json(r);
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-nova2-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawnServer(storePath, port);
  await waitForServer(baseUrl, serverProcess);
});
test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('local mode: keyword answer, provider local, history has 2 messages', async () => {
  const s = await createStudent(baseUrl, 'Nova One', 'novaone');
  const { res, body } = await chat(baseUrl, s.cookie, 'explain binary search');
  await assertStatus(res, 200, 'chat binary search');
  assert.equal(body.provider, 'local');
  assert.match(body.reply, /midpoint/i);
  assert.equal(body.screen, 'player');
  assert.ok(Array.isArray(body.suggestions) && body.suggestions.length > 0);
  const h = await history(baseUrl, s.cookie);
  assert.equal(h.provider, 'local');
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].role, 'user');
  assert.equal(h.messages[1].role, 'assistant');
});

test('local mode: assignments keyword still works', async () => {
  const s = await createStudent(baseUrl, 'Nova Two', 'novatwo');
  const { res, body } = await chat(baseUrl, s.cookie, 'what assignments do I have?');
  await assertStatus(res, 200, 'chat assignments');
  assert.equal(body.provider, 'local');
  assert.match(body.reply, /assignment/i);
  assert.equal(body.screen, 'assignments');
});

test('multi-turn: two messages leave 4 history entries, follow-up keeps context', async () => {
  const s = await createStudent(baseUrl, 'Nova Three', 'novathree');
  await chat(baseUrl, s.cookie, 'explain binary search');
  const { res } = await chat(baseUrl, s.cookie, 'why?');
  await assertStatus(res, 200, 'follow-up why');
  const h = await history(baseUrl, s.cookie);
  assert.equal(h.messages.length, 4);
  assert.equal(h.messages[0].content, 'explain binary search');
  assert.equal(h.messages[2].content, 'why?');
});

test('history cap: 12 turns keep only the last 20 messages', async () => {
  const s = await createStudent(baseUrl, 'Nova Four', 'novafour');
  for (let i = 1; i <= 12; i++) {
    const { res } = await chat(baseUrl, s.cookie, `cap message ${i}`);
    await assertStatus(res, 200, 'cap turn ' + i);
  }
  const h = await history(baseUrl, s.cookie);
  assert.equal(h.messages.length, 20);
  assert.equal(h.messages[0].content, 'cap message 3');
  assert.equal(h.messages[19].role, 'assistant');
});

test('clear empties history', async () => {
  const s = await createStudent(baseUrl, 'Nova Five', 'novafive');
  await chat(baseUrl, s.cookie, 'explain binary search');
  let r = await jsonReq(baseUrl, '/api/chat/clear', { method: 'POST', body: '{}' }, s.cookie);
  await assertStatus(r, 200, 'chat clear');
  assert.equal((await json(r)).cleared, true);
  const h = await history(baseUrl, s.cookie);
  assert.equal(h.messages.length, 0);
});

test('regenerate replaces the assistant message, user message kept once', async () => {
  const s = await createStudent(baseUrl, 'Nova Six', 'novasix');
  await chat(baseUrl, s.cookie, 'explain binary search');
  const r = await jsonReq(baseUrl, '/api/chat/regenerate', { method: 'POST', body: '{}' }, s.cookie);
  await assertStatus(r, 200, 'regenerate');
  const body = await json(r);
  assert.equal(body.provider, 'local');
  const h = await history(baseUrl, s.cookie);
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(h.messages[0].content, 'explain binary search');
  assert.equal(h.messages[1].role, 'assistant');
});

test('history isolation: user B cannot see user A history', async () => {
  const a = await createStudent(baseUrl, 'Nova Eight', 'novaeight');
  const b = await createStudent(baseUrl, 'Nova Nine', 'novanine');
  await chat(baseUrl, a.cookie, 'my secret topic is quokkas');
  const hb = await history(baseUrl, b.cookie);
  assert.equal(hb.messages.length, 0);
  const ha = await history(baseUrl, a.cookie);
  assert.equal(ha.messages.length, 2);
  assert.match(ha.messages[0].content, /quokkas/);
  // B has no history, so regenerate is a 400 for B too.
  const r = await jsonReq(baseUrl, '/api/chat/regenerate', { method: 'POST', body: '{}' }, b.cookie);
  await assertStatus(r, 400, 'regenerate empty');
});

test('rate limit: 31st message in a minute is 429', async () => {
  const s = await createStudent(baseUrl, 'Nova Ten', 'novaten');
  let lastStatus = 0;
  for (let i = 0; i < 31; i++) {
    const r = await jsonReq(baseUrl, '/api/chat', { method: 'POST', body: JSON.stringify({ message: 'rate test ' + i }) }, s.cookie);
    lastStatus = r.status;
    if (i < 30) assert.equal(r.status, 200, 'rate message ' + i);
    await r.text().catch(() => {});
  }
  assert.equal(lastStatus, 429);
});

/* ---- Streaming against a stubbed OpenAI server ---- */
test.describe('streaming with stubbed OpenAI', () => {
  let fake, fakePort, fakeUrl, keyBase, keyPort, keyProc, keyDir, seenBodies;
  test.before(async () => {
    seenBodies = [];
    fakePort = await freePort();
    fake = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch {}
        seenBodies.push(body);
        const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user');
        const text = (lastUser && lastUser.content) || '';
        if (text.includes('TRIGGER429')) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'insufficient_quota' } })); return; }
        if (text.includes('TRIGGERDROP')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
          setImmediate(() => { try { res.socket.destroy(); } catch {} });
          return;
        }
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"streamed world"}}]}\n\ndata: [DONE]\n\n');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'Hello non-streamed world' } }] }));
      });
    });
    await new Promise(r => fake.listen(fakePort, '127.0.0.1', r));
    fakeUrl = `http://127.0.0.1:${fakePort}/v1`;
    keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-nova2key-'));
    const storePath = path.join(keyDir, 'store.json');
    await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
    keyPort = await freePort();
    keyBase = `http://127.0.0.1:${keyPort}`;
    keyProc = spawnServer(storePath, keyPort, { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: fakeUrl });
    await waitForServer(keyBase, keyProc);
  });
  test.after(async () => {
    if (keyProc && keyProc.exitCode === null) {
      keyProc.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
      if (keyProc.exitCode === null) keyProc.kill('SIGKILL');
    }
    if (fake) await new Promise(r => fake.close(r));
    if (keyDir) await fs.rm(keyDir, { recursive: true, force: true });
  });

  test('stream:true returns SSE deltas + done event with provider openai', async () => {
    const s = await createStudent(keyBase, 'Stream One', 'streamone');
    const r = await jsonReq(keyBase, '/api/chat', { method: 'POST', body: JSON.stringify({ message: 'hello stream', stream: true }) }, s.cookie);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    const text = await r.text();
    assert.match(text, /"delta":"Hello "/);
    assert.match(text, /"delta":"streamed world"/);
    assert.match(text, /"done":true/);
    assert.match(text, /"provider":"openai"/);
    assert.match(text, /"reply":"Hello streamed world"/);
    const h = await history(keyBase, s.cookie);
    assert.equal(h.provider, 'openai');
    assert.equal(h.messages.length, 2);
    assert.equal(h.messages[1].content, 'Hello streamed world');
  });

  test('no stream flag with a key returns JSON provider openai', async () => {
    const s = await createStudent(keyBase, 'Stream Two', 'streamtwo');
    const { res, body } = await chat(keyBase, s.cookie, 'hello json');
    await assertStatus(res, 200, 'openai json chat');
    assert.equal(body.provider, 'openai');
    assert.equal(body.reply, 'Hello non-streamed world');
  });

  test('second turn sends the first turn as history to the LLM', async () => {
    const s = await createStudent(keyBase, 'Stream Three', 'streamthree');
    await chat(keyBase, s.cookie, 'first question about binary search');
    await chat(keyBase, s.cookie, 'and the second part');
    const second = seenBodies[seenBodies.length - 1];
    assert.equal(second.messages[0].role, 'system');
    const contents = second.messages.map(m => m.content).join(' | ');
    assert.match(contents, /first question about binary search/);
    assert.match(contents, /Hello non-streamed world/);
    assert.match(contents, /and the second part/);
  });

  test('LLM 429 falls back to local with provider local', async () => {
    const s = await createStudent(keyBase, 'Stream Four', 'streamfour');
    const { res, body } = await chat(keyBase, s.cookie, 'TRIGGER429 explain binary search');
    await assertStatus(res, 200, '429 fallback');
    assert.equal(body.provider, 'local');
    assert.match(body.reply, /midpoint/i);
    const h = await history(keyBase, s.cookie);
    assert.equal(h.messages.length, 2);
    assert.match(h.messages[0].content, /TRIGGER429/);
  });

  test('mid-stream drop sends an SSE error event', async () => {
    const s = await createStudent(keyBase, 'Stream Five', 'streamfive');
    const r = await jsonReq(keyBase, '/api/chat', { method: 'POST', body: JSON.stringify({ message: 'TRIGGERDROP hello', stream: true }) }, s.cookie);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /"error"/);
  });
});
