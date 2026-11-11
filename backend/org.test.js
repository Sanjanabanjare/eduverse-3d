'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl;
let port;
let serverProcess;
let tempDir;
let superCookie;   // role 'admin' -> treated as super_admin
let instAdminCookie;
let instAId, instBId;

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

async function req(url, options, cookie) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options?.headers || {}), 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`); }
}

function cookieOf(res) { return (res.headers.get('set-cookie') || '').split(';')[0]; }

async function assertStatus(res, expected, label) {
  if (res.status !== expected) assert.equal(res.status, expected, `${label}: ${await res.text()}`);
  assert.equal(res.status, expected, label);
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-org-'));
  const storePath = path.join(tempDir, 'store.json');
  // Seed one legacy user + course with no institutionId to exercise migration.
  await fs.writeFile(storePath, JSON.stringify({
    users: [{ id: 'legacy-user-1', name: 'Legacy', username: 'legacy', email: '', passwordHash: 'x', role: 'student', status: 'active', createdAt: new Date().toISOString() }],
    courses: [{ id: 'legacy-course-1', title: 'Legacy Course', status: 'published' }],
    adminAudit: [],
  }));
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

  // First admin via setup-admin (role 'admin' == super_admin for backward compat).
  let r = await req('/api/auth/setup-admin', { method: 'POST', body: JSON.stringify({ name: 'Root', username: 'root', password: 'Password123456', setupCode: '123456', otpVerified: true, otpCode: '123456', termsAccepted: true }) });
  await assertStatus(r, 201, 'setup-admin: ');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'root', password: 'Password123456' }) });
  await assertStatus(r, 200, 'admin login: ');
  superCookie = cookieOf(r);

  // Migration check happens after this; grab the Default Institution id.
  const insts = await json(await req('/api/admin/institutions', {}, superCookie));
  instAId = insts.institutions.find(i => i.slug === 'default').id;

  // Create institution B.
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Second College', slug: 'second-college' }) }, superCookie);
  await assertStatus(r, 201, 'create institution B: ');
  instBId = (await json(r)).institution.id;

  // Create an institution_admin scoped to A.
  r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Inst Admin', email: 'ia@example.com', password: 'Password123456', role: 'institution_admin', institutionId: instAId }) }, superCookie);
  await assertStatus(r, 201, 'create institution_admin: ');
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ia@example.com', password: 'Password123456' }) });
  await assertStatus(r, 200, 'institution_admin login: ');
  instAdminCookie = cookieOf(r);
});

test.after(async () => {
  try { serverProcess.kill('SIGTERM'); } catch {}
});

test('migration creates Default Institution and stamps legacy rows', async () => {
  const insts = await json(await req('/api/admin/institutions', {}, superCookie));
  assert.ok(insts.institutions.some(i => i.slug === 'default' && i.name === 'Default Institution'), 'default institution exists');
  const users = await json(await req('/api/admin/users', {}, superCookie));
  const legacy = users.users.find(u => u.username === 'legacy');
  assert.ok(legacy, 'legacy user listed');
  assert.equal(legacy.institutionId, instAId, 'legacy user stamped with default institution');
});

test('slug validation rejects bad slugs', async () => {
  let r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Bad Slug U', slug: 'Bad_Slug!' }) }, superCookie);
  assert.equal(r.status, 400, 'bad slug rejected');
  r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'No Name', slug: 'x' }) }, superCookie);
  assert.equal(r.status, 400, 'short name/slug rejected');
});

test('institution_admin cannot create institutions', async () => {
  const r = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Sneaky', slug: 'sneaky' }) }, instAdminCookie);
  assert.equal(r.status, 403, 'institution_admin blocked from creating institutions');
});

test('org isolation: institution admin cannot list another institution departments', async () => {
  // Super admin creates a department in B.
  let r = await req('/api/admin/departments', { method: 'POST', body: JSON.stringify({ name: 'Physics', institutionId: instBId }) }, superCookie);
  await assertStatus(r, 201, 'dept in B: ');
  // Institution admin of A asks for B's departments -> 403.
  r = await req(`/api/admin/departments?institutionId=${instBId}`, {}, instAdminCookie);
  assert.equal(r.status, 403, 'cross-institution department list blocked');
  // Default listing for A does not leak B's department.
  const mine = await json(await req('/api/admin/departments', {}, instAdminCookie));
  assert.ok(mine.departments.every(d => d.institutionId !== instBId), 'no cross-institution leak in default list');
  // Super admin can still see all.
  const all = await json(await req(`/api/admin/departments?institutionId=${instBId}`, {}, superCookie));
  assert.equal(all.departments.length, 1, 'super admin sees B departments');
});

test('isCurrent exclusivity on academic years', async () => {
  const mk = async (name, isCurrent) => {
    const r = await req('/api/admin/academic-years', { method: 'POST', body: JSON.stringify({ name, institutionId: instAId, startsAt: '2025-06-01', endsAt: '2026-05-31', isCurrent }) }, superCookie);
    await assertStatus(r, 201, 'create year ' + name + ': ');
    return (await json(r)).academicYear;
  };
  const y1 = await mk('2025-26', true);
  const y2 = await mk('2026-27', true);
  const list = await json(await req(`/api/admin/academic-years?institutionId=${instAId}`, {}, superCookie));
  const current = list.academicYears.filter(y => y.isCurrent);
  assert.equal(current.length, 1, 'exactly one current year');
  assert.equal(current[0].id, y2.id, 'latest set-current wins');
  assert.ok(!list.academicYears.find(y => y.id === y1.id).isCurrent, 'first year unset');
  // Bad date range rejected.
  const bad = await req('/api/admin/academic-years', { method: 'POST', body: JSON.stringify({ name: 'Bad Dates', institutionId: instAId, startsAt: '2026-05-31', endsAt: '2025-06-01' }) }, superCookie);
  assert.equal(bad.status, 400, 'endsAt before startsAt rejected');
});

test('semesters nest under years with isCurrent exclusivity', async () => {
  const years = await json(await req(`/api/admin/academic-years?institutionId=${instAId}`, {}, superCookie));
  const yid = years.academicYears[0].id;
  const mk = async (name, isCurrent) => {
    const r = await req(`/api/admin/academic-years/${yid}/semesters`, { method: 'POST', body: JSON.stringify({ name, startsAt: '2025-06-01', endsAt: '2025-12-31', isCurrent }) }, superCookie);
    await assertStatus(r, 201, 'create semester: ');
    return (await json(r)).semester;
  };
  await mk('Sem 1', true);
  const s2 = await mk('Sem 2', true);
  const list = await json(await req(`/api/admin/academic-years/${yid}/semesters`, {}, superCookie));
  const current = list.semesters.filter(s => s.isCurrent);
  assert.equal(current.length, 1, 'exactly one current semester per year');
  assert.equal(current[0].id, s2.id, 'latest wins');
});

test('branding endpoint is public', async () => {
  const r = await req('/api/institution/branding');
  assert.equal(r.status, 200, 'public branding reachable');
  const b = await json(r);
  assert.ok(b.name && /^#[0-9a-fA-F]{6}$/.test(b.primaryColor), 'branding shape valid');
});

test('branding update validates color and URL', async () => {
  let r = await req(`/api/admin/institutions/${instAId}`, { method: 'PATCH', body: JSON.stringify({ branding: { logoUrl: 'https://example.com/logo.png', primaryColor: '#123abc', faviconUrl: '/favicon.ico' } }) }, superCookie);
  await assertStatus(r, 200, 'valid branding accepted: ');
  r = await req(`/api/admin/institutions/${instAId}`, { method: 'PATCH', body: JSON.stringify({ branding: { primaryColor: 'red' } }) }, superCookie);
  assert.equal(r.status, 400, 'bad color rejected');
  r = await req(`/api/admin/institutions/${instAId}`, { method: 'PATCH', body: JSON.stringify({ branding: { logoUrl: 'javascript:alert(1)' } }) }, superCookie);
  assert.equal(r.status, 400, 'bad URL rejected');
});

test('role-permissions PATCH 403 for institution_admin, 200 for super_admin', async () => {
  let r = await req('/api/admin/role-permissions', { method: 'PATCH', body: JSON.stringify({ rolePermissions: { teacher: ['courses.create'] } }) }, instAdminCookie);
  assert.equal(r.status, 403, 'institution_admin cannot edit role permissions');
  r = await req('/api/admin/role-permissions', { method: 'GET' }, instAdminCookie);
  assert.equal(r.status, 403, 'institution_admin cannot view role permissions');
  r = await req('/api/admin/role-permissions', { method: 'GET' }, superCookie);
  assert.equal(r.status, 200, 'super_admin can view role permissions');
  const before = await json(r);
  assert.ok(Array.isArray(before.roles) && before.roles.includes('institution_admin'), 'roles listed');
  r = await req('/api/admin/role-permissions', { method: 'PATCH', body: JSON.stringify({ rolePermissions: { teacher: ['courses.create', 'courses.publish'] } }) }, superCookie);
  assert.equal(r.status, 200, 'super_admin can edit role permissions');
  const after = await json(await req('/api/admin/role-permissions', { method: 'GET' }, superCookie));
  assert.deepEqual(after.matrix.teacher, ['courses.create', 'courses.publish'], 'matrix persisted');
  // Unknown permission rejected.
  r = await req('/api/admin/role-permissions', { method: 'PATCH', body: JSON.stringify({ rolePermissions: { teacher: ['nope.manage'] } }) }, superCookie);
  assert.equal(r.status, 400, 'unknown permission rejected');
});

test('institution_admin user creation is scoped to their institution', async () => {
  const r = await req('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: 'Scoped Student', email: 'scoped@example.com', password: 'Password123456', role: 'student', institutionId: instBId }) }, instAdminCookie);
  await assertStatus(r, 201, 'creation allowed: ');
  const u = (await json(r)).user;
  assert.equal(u.institutionId, instAId, 'forced into creator institution, not requested B');
});

test('institution DELETE suspends when it has users instead of hard delete', async () => {
  const r = await req(`/api/admin/institutions/${instAId}`, { method: 'DELETE' }, superCookie);
  await assertStatus(r, 200, 'delete handled: ');
  const d = await json(r);
  assert.equal(d.suspended, true, 'suspended rather than deleted');
  assert.equal(d.institution.status, 'suspended', 'status flipped');
  // Empty institution hard-deletes.
  const mk = await req('/api/admin/institutions', { method: 'POST', body: JSON.stringify({ name: 'Empty College', slug: 'empty-college' }) }, superCookie);
  const emptyId = (await json(mk)).institution.id;
  const del = await req(`/api/admin/institutions/${emptyId}`, { method: 'DELETE' }, superCookie);
  assert.equal((await json(del)).deleted, true, 'empty institution hard-deleted');
});
