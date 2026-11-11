'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let child, baseUrl, tempDir;

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForApi() {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('Production test server exited before becoming ready.');
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Production test server did not become ready.');
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-production-config-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [] }));
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'production', APP_BASE_URL: 'https://eduverse.example.test', EDUVERSE_STORE_PATH: storePath, JWT_SECRET: 'production-config-test-secret-at-least-32-chars' };
  delete env.EDUVERSE_ADMIN_SETUP_CODE;
  delete env.EDUVERSE_BOOTSTRAP_ADMIN_EMAIL;
  delete env.EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD;
  child = spawn(process.execPath, ['backend/server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'ignore' });
  await waitForApi();
});

test.after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('production refuses first-admin setup without a long private setup code', async () => {
  const response = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Root Admin', username: 'rootadmin', password: 'Password123456', setupCode: '123456', otpCode: '123456', otpVerified: true, termsAccepted: true }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /at least 32 characters/i);
});

test('production refuses teacher self-signup that relies on the demo OTP', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Teacher Example', username: 'teacherexample', password: 'Password123456', role: 'teacher', otpCode: '123456', otpVerified: true, termsAccepted: true }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /real email verification provider/i);
});

test('production still allows student signup without a demo OTP', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Student Example', username: 'studentexample', password: 'Password123456', role: 'student', termsAccepted: true }),
  });
  assert.equal(response.status, 201);
});

test('canonical HTTPS APP_BASE_URL allows same-site writes behind a TLS proxy', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'studentexample', password: 'Password123456' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${baseUrl}/api/profile/language`, {
    method: 'POST', headers: {
      'content-type': 'application/json',
      Cookie: cookie,
      Origin: 'https://eduverse.example.test',
      Host: 'eduverse.example.test',
    },
    body: JSON.stringify({ lang: 'en' }),
  });
  assert.equal(response.status, 200, await response.text());
});
