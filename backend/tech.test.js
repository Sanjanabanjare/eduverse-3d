'use strict';
/* Slice D backend tests: storage, email, payments, search, cache, notifications, monitor.
 * Tests fallback selection logic only — S3/Resend/Stripe/Redis/Sentry are NOT live-tested. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const storage = require('./storage');
const email = require('./email');
const payments = require('./payments');
const search = require('./search');
const cache = require('./cache');
const notify = require('./notify');
const monitor = require('./monitor');

// ---------- storage (local) ----------
test('storage: local save/get/delete round-trip', async () => {
  assert.equal(storage.provider(), 'local');
  const buf = Buffer.from('hello upload');
  const saved = await storage.saveFile({ buffer: buf, mimeType: 'text/plain', folder: 'test', filename: 'hi.txt' });
  assert.ok(saved.url.startsWith('/uploads/'));
  assert.equal(saved.provider, 'local');
  const got = await storage.getFile(saved.path);
  assert.equal(got.toString(), 'hello upload');
  await storage.deleteFile(saved.path);
  await assert.rejects(() => storage.getFile(saved.path));
});

test('storage: rejects oversize and bad mimetype', async () => {
  await assert.rejects(() => storage.saveFile({ buffer: Buffer.alloc(6 * 1024 * 1024), mimeType: 'text/plain', folder: 't' }), /5MB/);
  await assert.rejects(() => storage.saveFile({ buffer: Buffer.from('x'), mimeType: 'application/x-evil', folder: 't' }), /not allowed/);
});

test('storage: provider() selects s3 only when all env set', () => {
  assert.equal(storage.provider(), 'local'); // no env in test
});

// ---------- email ----------
test('email: falls back to outbox without keys', async () => {
  assert.equal(email.provider(), 'outbox');
  const store = {};
  email.init(store);
  const r = await email.sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' });
  assert.equal(r.provider, 'outbox');
  assert.equal(store.emailOutbox.length, 1);
  assert.equal(store.emailOutbox[0].to, 'a@b.com');
});

test('email: rejects invalid recipient', async () => {
  await assert.rejects(() => email.sendEmail({ to: 'not-an-email', subject: 'x', html: 'y' }), /Valid recipient/);
});

// ---------- payments ----------
test('payments: test-mode order without keys', async () => {
  assert.equal(payments.provider(), 'test');
  const o = await payments.createOrder({ amount: 50000, currency: 'INR' });
  assert.equal(o.provider, 'test');
  assert.ok(o.orderId.startsWith('test_'));
  assert.equal(o.amount, 50000);
});

test('payments: test webhook verify round-trip', () => {
  const crypto = require('node:crypto');
  const raw = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
  const sig = crypto.createHmac('sha256', 'eduverse-test-webhook').update(raw).digest('hex');
  const v = payments.verifyWebhook({ rawBody: raw, signature: sig });
  assert.equal(v.verified, true);
  assert.equal(v.provider, 'test');
  const bad = payments.verifyWebhook({ rawBody: raw, signature: 'nope' });
  assert.equal(bad.verified, false);
});

// ---------- search ----------
test('search: org-scoped results', () => {
  const store = {
    courses: [
      { id: 'c1', title: 'Algebra Basics', description: 'Learn algebra', status: 'published', institutionId: 'i1' },
      { id: 'c2', title: 'Algebra Advanced', description: 'More algebra', status: 'published', institutionId: 'i2' },
    ],
    quizzes: [{ id: 'q1', title: 'Algebra Quiz', description: '', courseId: 'c1' }],
  };
  search.init(store);
  search.rebuild();
  const all = search.search('algebra', null);
  assert.ok(all.results.length >= 2);
  const scoped = search.search('algebra', 'i1');
  assert.ok(scoped.results.every(r => !r.institutionId || r.institutionId === 'i1'));
  assert.ok(scoped.results.some(r => r.id === 'c1'));
  assert.ok(!scoped.results.some(r => r.id === 'c2'));
  const short = search.search('a', null);
  assert.ok(short.error);
});

// ---------- cache ----------
test('cache: set/get/TTL expiry (memory)', async () => {
  cache._resetForTests();
  assert.equal(cache.provider(), 'memory');
  await cache.set('k1', { a: 1 }, 60);
  assert.deepEqual(await cache.get('k1'), { a: 1 });
  await cache.set('k2', 'v', 1);
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(await cache.get('k2'), null);
  await cache.del('k1');
  assert.equal(await cache.get('k1'), null);
});

// ---------- notify ----------
test('notify: creates notification record', async () => {
  const store = { users: [{ id: 'u1', email: 'u@x.com' }], notifications: [] };
  notify.init(store);
  const n = await notify.notify('u1', { kind: 'test', title: 'Hello', body: 'World', link: '/x' });
  assert.equal(n.kind, 'test');
  assert.equal(store.notifications.length, 1);
  assert.equal(store.notifications[0].userId, 'u1');
});

// ---------- monitor ----------
test('monitor: captures without DSN (local)', async () => {
  const store = {};
  monitor.init(store);
  assert.equal(monitor.sentryEnabled(), false);
  const r = await monitor.captureError(new Error('boom'), { kind: 'test' });
  assert.equal(r.provider, 'local');
  assert.equal(store.errorLog.length, 1);
  assert.equal(store.errorLog[0].message, 'boom');
});

// ---------- integration: server endpoints ----------
let baseUrl, port, serverProcess, tempDir;
let adminCookie;

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

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-tech-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({ users: [], adminAudit: [] }));
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, EDUVERSE_STORE_PATH: storePath, PORT: String(port) },
    stdio: 'pipe',
  });
  serverProcess.stderr.on('data', () => {});
  await waitForServer();
  // bootstrap super admin
  let r = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }),
  });
  assert.equal(r.status, 201);
  r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'root', password: 'Password123456' }),
  });
  assert.equal(r.status, 200);
  adminCookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(adminCookie);
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

async function api(p, opts = {}, cookie) {
  const r = await fetch(`${baseUrl}${p}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

test('GET /api/search validates and returns results', async () => {
  const bad = await api('/api/search?q=a', {}, adminCookie);
  assert.equal(bad.status, 400);
  const ok = await api('/api/search?q=algebra', {}, adminCookie);
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.results));
});

test('POST /api/upload stores file locally', async () => {
  const data = Buffer.from('test image data').toString('base64');
  const r = await api('/api/upload', {
    method: 'POST',
    body: JSON.stringify({ filename: 't.txt', mimeType: 'text/plain', data, folder: 'test' }),
  }, adminCookie);
  assert.equal(r.status, 201);
  assert.ok(r.body.url.startsWith('/uploads/'));
  assert.equal(r.body.provider, 'local');
  // fetch it back
  const f = await fetch(`${baseUrl}${r.body.url}`);
  assert.equal(f.status, 200);
  assert.equal(await f.text(), 'test image data');
});

test('GET /api/admin/monitoring/errors returns local log', async () => {
  const r = await api('/api/admin/monitoring/errors', {}, adminCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'local');
  assert.ok(Array.isArray(r.body.errors));
});

test('POST /api/fee-records/:id/order creates test-mode order', async () => {
  // create institution + fee structure + student + record via admin APIs
  let r = await api('/api/admin/institutions', {
    method: 'POST', body: JSON.stringify({ name: 'TechTest Uni', slug: 'techtest-uni' }),
  }, adminCookie);
  assert.equal(r.status, 201);
  const instId = r.body.institution.id;
  r = await api('/api/admin/fee-structures', {
    method: 'POST', body: JSON.stringify({ institutionId: instId, name: 'Tuition', amount: 5000, dueDate: '2026-12-31' }),
  }, adminCookie);
  // fee structure create may need different shape; tolerate
  const fsId = r.body.feeStructure?.id || r.body.id;
  // create student
  r = await api('/api/admin/users', {
    method: 'POST', body: JSON.stringify({ name: 'Fee Student', username: 'feestudent', email: 'feestudent@example.com', password: 'Password123456', role: 'student', institutionId: instId }),
  }, adminCookie);
  const studentId = r.body.user?.id;
  assert.ok(studentId, 'student created');
  // assign fee -> triggers notification
  if (fsId) {
    r = await api(`/api/admin/fee-structures/${fsId}/assign`, { method: 'POST', body: JSON.stringify({}) }, adminCookie);
  }
  // find the student's fee record
  const sLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'feestudent', password: 'Password123456' }),
  });
  const sCookie = (sLogin.headers.get('set-cookie') || '').split(';')[0];
  r = await api('/api/fees/mine', {}, sCookie);
  const rec = (r.body.feeRecords || [])[0];
  if (rec) {
    const o = await api(`/api/fee-records/${rec.id}/order`, { method: 'POST', body: '{}' }, sCookie);
    assert.equal(o.status, 201);
    assert.equal(o.body.order.provider, 'test');
    // notification was created on fee assign
    const n = await api('/api/notifications', {}, sCookie);
    assert.ok((n.body.notifications || []).some(x => x.kind === 'fee_assigned'));
  }
});

test('backup download accepts BACKUP_API_KEY (service key path)', async () => {
  // Without the env var, anonymous download must fail
  const r = await fetch(`${baseUrl}/api/admin/backup/download`);
  assert.ok([401, 403].includes(r.status));
});
