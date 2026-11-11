'use strict';
/* Slice C backend tests: security events, login activity, backup/restore, integrations. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl, port, serverProcess, tempDir;
let superCookie, instAdminCookie, studentCookie, studentId;

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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-sec-'));
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
  const instAId = insts.institutions.find(i => i.slug === 'default').id;

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create inst admin');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'inst admin login');
  instAdminCookie = cookieOf(r);

  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'S One', email: 's1@example.com', password: 'Password123456', role: 'student', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create student');
  studentId = (await json(r)).user.id;
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 's1@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'student login');
  studentCookie = cookieOf(r);
});

test.after(async () => { try { serverProcess.kill('SIGTERM'); } catch {} });

test('new security permissions are in the matrix', async () => {
  const m = await json(await req('/api/admin/role-permissions', {}, superCookie));
  for (const p of ['security.view', 'backup.manage', 'integrations.manage']) {
    assert.ok(m.matrix.super_admin.includes(p), `super_admin has ${p}`);
  }
  assert.ok(m.matrix.institution_admin.includes('security.view'), 'institution_admin has security.view');
  assert.ok(m.matrix.institution_admin.includes('integrations.manage'), 'institution_admin has integrations.manage');
  assert.ok(!m.matrix.institution_admin.includes('backup.manage'), 'institution_admin lacks backup.manage');
});

test('failed login is logged as a security event', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 's1@example.com', password: 'WrongPassword999' }) });
  await assertStatus(r, 401, 'bad login rejected');
  const ev = await json(await req('/api/admin/security/events?type=login_failed', {}, superCookie));
  const hit = ev.events.find(e => e.type === 'login_failed' && e.actor === 's1@example.com');
  assert.ok(hit, 'login_failed event present');
  assert.equal(hit.severity, 'medium');
  assert.ok(hit.ip, 'ip recorded');
});

test('brute-force escalation after repeated failures', async () => {
  for (let i = 0; i < 5; i++) {
    await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'brutetest@example.com', password: 'WrongPassword999' }) });
  }
  const ev = await json(await req('/api/admin/security/events?type=brute_force', {}, superCookie));
  const hit = ev.events.find(e => e.type === 'brute_force');
  assert.ok(hit, 'brute_force event present');
  assert.equal(hit.severity, 'high');
});

test('rate-limit hits are logged', async () => {
  // 8/min per identifier allowed; the 9th trips the limiter.
  let saw429 = false;
  for (let i = 0; i < 9; i++) {
    const r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ratelimit@example.com', password: 'WrongPassword999' }) });
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429, 'rate limiter tripped');
  const ev = await json(await req('/api/admin/security/events?type=rate_limited', {}, superCookie));
  assert.ok(ev.events.some(e => e.type === 'rate_limited' && e.severity === 'low'), 'rate_limited event present');
});

test('forbidden admin access is logged', async () => {
  const r = await req('/api/admin/security/events', {}, studentCookie);
  await assertStatus(r, 403, 'student blocked from admin security');
  const ev = await json(await req('/api/admin/security/events?type=forbidden_admin', {}, superCookie));
  const hit = ev.events.find(e => e.type === 'forbidden_admin');
  assert.ok(hit, 'forbidden_admin event present');
  assert.equal(hit.severity, 'medium');
  assert.ok(hit.detail.includes('/api/admin/security/events'), 'path recorded');
});

test('security summary aggregates by severity and type', async () => {
  const s = await json(await req('/api/admin/security/summary', {}, superCookie));
  assert.ok(s.total >= 4, 'several events counted');
  assert.ok(s.bySeverity.medium >= 2, 'medium count');
  assert.ok(s.bySeverity.high >= 1, 'high count (brute force)');
  assert.ok(s.bySeverity.low >= 1, 'low count (rate limit)');
  assert.ok(s.byType.login_failed >= 1 && s.byType.brute_force >= 1, 'type counts');
});

test('login activity lists recent logins with ip', async () => {
  const d = await json(await req('/api/admin/security/logins?days=1', {}, superCookie));
  assert.ok(Array.isArray(d.logins) && d.logins.length >= 3, 'logins listed');
  const mine = d.logins.find(l => l.userId === studentId);
  assert.ok(mine, 'student login present');
  assert.ok(mine.ip, 'ip recorded on login event');
  assert.equal(typeof mine.userAgent, 'string');
  const filtered = await json(await req(`/api/admin/security/logins?userId=${studentId}`, {}, superCookie));
  assert.ok(filtered.logins.every(l => l.userId === studentId), 'userId filter works');
});

test('institution admin sees security events but cannot manage backup', async () => {
  const r = await req('/api/admin/security/events', {}, instAdminCookie);
  await assertStatus(r, 200, 'inst admin can view events');
  const dl = await req('/api/admin/backup/download', {}, instAdminCookie);
  await assertStatus(dl, 403, 'inst admin cannot download backup');
});

test('backup download streams the store as an attachment', async () => {
  const r = await req('/api/admin/backup/download', {}, superCookie);
  await assertStatus(r, 200, 'download ok');
  assert.ok((r.headers.get('content-type') || '').includes('application/json'), 'json content type');
  const cd = r.headers.get('content-disposition') || '';
  assert.ok(cd.includes('attachment') && cd.includes('eduverse-backup-'), `attachment filename (${cd})`);
  const body = await json(r);
  assert.ok(Array.isArray(body.users) && body.users.length >= 3, 'backup contains users');
  const info = await json(await req('/api/admin/backup/info', {}, superCookie));
  assert.ok(info.sizeBytes > 1000, 'size reported');
  assert.ok(info.collections.users >= 3, 'collection counts');
  assert.ok(info.lastBackupAt, 'lastBackupAt tracked after download');
});

test('backup restore requires confirm and super_admin', async () => {
  const dl = await req('/api/admin/backup/download', {}, superCookie);
  const backup = await json(dl);
  let r = await req('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ backup }) }, superCookie);
  await assertStatus(r, 400, 'confirm guard');
  r = await req('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ backup, confirm: true }) }, instAdminCookie);
  await assertStatus(r, 403, 'inst admin cannot restore');
  r = await req('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ backup: { nope: 1 }, confirm: true }) }, superCookie);
  await assertStatus(r, 400, 'invalid backup rejected');
  // Round-trip: add an integration, restore the earlier backup, integration is gone.
  r = await req('/api/admin/integrations', { method: 'POST', body: JSON.stringify({ kind: 'webhook', name: 'Marker Hook', config: { url: 'https://example.com/hook' }, secret: 's3cret' }) }, superCookie);
  await assertStatus(r, 201, 'marker integration');
  r = await req('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ backup, confirm: true }) }, superCookie);
  await assertStatus(r, 200, 'restore ok');
  const after = await json(await req('/api/admin/integrations', {}, superCookie));
  assert.ok(!after.integrations.some(i => i.name === 'Marker Hook'), 'store replaced by backup');
  // Server still serves after restore (store re-initialized).
  const ev = await req('/api/admin/security/events', {}, superCookie);
  await assertStatus(ev, 200, 'events endpoint works post-restore');
});

test('integration secrets are never leaked in GET', async () => {
  let r = await req('/api/admin/integrations', { method: 'POST', body: JSON.stringify({ kind: 'email', name: 'Mail Gun', config: { from: 'noreply@example.com' }, secret: 'topsecret-key' }) }, superCookie);
  await assertStatus(r, 201, 'create integration');
  const id = (await json(r)).integration.id;
  const list = await json(await req('/api/admin/integrations', {}, superCookie));
  const row = list.integrations.find(i => i.id === id);
  assert.ok(row, 'integration listed');
  assert.ok(!('configSecret' in row), 'configSecret not exposed');
  assert.equal(row.hasSecret, true, 'hasSecret flag');
  assert.ok(!JSON.stringify(list).includes('topsecret-key'), 'secret value absent from payload');
  // PATCH secret, then disable.
  r = await req(`/api/admin/integrations/${id}`, { method: 'PATCH', body: JSON.stringify({ secret: 'rotated-key', status: 'disabled' }) }, superCookie);
  await assertStatus(r, 200, 'patch ok');
  assert.equal((await json(r)).integration.status, 'disabled');
  const list2 = await json(await req('/api/admin/integrations', {}, superCookie));
  assert.ok(!JSON.stringify(list2).includes('rotated-key'), 'rotated secret still hidden');
  r = await req(`/api/admin/integrations/${id}`, { method: 'DELETE' }, superCookie);
  await assertStatus(r, 200, 'delete ok');
  const list3 = await json(await req('/api/admin/integrations', {}, superCookie));
  assert.ok(!list3.integrations.some(i => i.id === id), 'deleted');
});

test('webhook test handles bad URL gracefully', async () => {
  let r = await req('/api/admin/integrations', { method: 'POST', body: JSON.stringify({ kind: 'webhook', name: 'Dead Hook', config: { url: 'http://127.0.0.1:9/hook' } }) }, superCookie);
  await assertStatus(r, 201, 'create webhook');
  const id = (await json(r)).integration.id;
  r = await req(`/api/admin/integrations/${id}/test`, { method: 'POST', body: JSON.stringify({}) }, superCookie);
  await assertStatus(r, 200, 'test endpoint responds');
  const out = await json(r);
  assert.equal(out.ok, false, 'unreachable host reports ok:false, no throw');
  await req(`/api/admin/integrations/${id}`, { method: 'DELETE' }, superCookie);
});

test('non-webhook test validates config honestly', async () => {
  let r = await req('/api/admin/integrations', { method: 'POST', body: JSON.stringify({ kind: 'payment', name: 'Pay Gate', config: {} }) }, superCookie);
  const id = (await json(r)).integration.id;
  r = await req(`/api/admin/integrations/${id}/test`, { method: 'POST', body: JSON.stringify({}) }, superCookie);
  let out = await json(r);
  assert.equal(out.ok, false, 'missing provider fails validation');
  assert.ok(out.error.includes('provider'), 'names the missing field');
  await req(`/api/admin/integrations/${id}`, { method: 'PATCH', body: JSON.stringify({ config: { provider: 'razorpay' } }) }, superCookie);
  r = await req(`/api/admin/integrations/${id}/test`, { method: 'POST', body: JSON.stringify({}) }, superCookie);
  out = await json(r);
  assert.equal(out.ok, true);
  assert.equal(out.live, false, 'honest: not live-tested');
  await req(`/api/admin/integrations/${id}`, { method: 'DELETE' }, superCookie);
});

test('invalid integration kind rejected', async () => {
  const r = await req('/api/admin/integrations', { method: 'POST', body: JSON.stringify({ kind: 'sms', name: 'X' }) }, superCookie);
  await assertStatus(r, 400, 'bad kind');
});
