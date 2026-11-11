'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let baseUrl;
let cookie;
let serverProcess;
let tempDir;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
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

async function request(url, options = {}) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
}

async function requestAs(url, options, sessionCookie) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { ...(options?.headers || {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}) } });
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduverse-api-resilience-'));
  const storePath = path.join(tempDir, 'store.json');
  await fs.writeFile(storePath, JSON.stringify({
    users: [], adminAudit: [],
    courses: [{ id: 'course-retry-test', title: 'Retry safety', status: 'published' }],
  }));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), EDUVERSE_STORE_PATH: storePath, NODE_ENV: 'test', EDUVERSE_BOOTSTRAP_ADMIN_EMAIL: 'audit.admin@example.test', EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD: 'Audit-admin-password-123' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  serverProcess.once('exit', code => { if (code && !serverProcess.startupError) serverProcess.startupError = new Error(stderr); });
  await waitForServer();

  const signup = await request('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Retry Test Student', username: 'retry.student', password: 'Retry-safety-123', role: 'student', termsAccepted: true }),
  });
  assert.equal(signup.status, 201);
  const login = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'retry.student', password: 'Retry-safety-123' }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => serverProcess.once('exit', resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('simultaneous course-enrollment retries create one record and replay one response', async () => {
  const enroll = () => request('/api/courses/course-retry-test/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'student-enroll-retry-001' },
    body: '{}',
  });
  const [first, second] = await Promise.all([enroll(), enroll()]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(await first.json(), await second.json());
  const enrollments = await request('/api/my-enrollments');
  assert.equal(enrollments.headers.get('cache-control'), 'no-store');
  assert.equal((await enrollments.json()).enrollments.length, 1);
});

test('same key with a different request body cannot silently reuse a cached result', async () => {
  const response = await request('/api/courses/course-retry-test/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'student-enroll-retry-001' },
    body: JSON.stringify({ differentIntent: true }),
  });
  assert.equal(response.status, 409);
});

test('student credentials cannot access administrator endpoints even with a replay key', async () => {
  const response = await request('/api/admin/enrollments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'admin-route-replay-01' },
    body: JSON.stringify({ courseId: 'course-retry-test', studentId: 'someone' }),
  });
  assert.equal(response.status, 403);
});

test('missing or tampered sessions and untrusted request origins are denied', async () => {
  const anonymousAdmin = await requestAs('/api/admin/users', {}, 'eduverse_session=not-a-valid-session');
  assert.equal(anonymousAdmin.status, 401);
  const rejectedOrigin = await requestAs('/api/profile', {
    headers: { Origin: 'https://attacker.example' },
  }, cookie);
  assert.equal(rejectedOrigin.status, 403);
});

test('two student accounts cannot read each other’s notes or change their own role', async () => {
  const signup = await requestAs('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Second Test Student', username: 'second.student', password: 'Second-student-123', role: 'student', termsAccepted: true }),
  });
  assert.equal(signup.status, 201);
  const login = await requestAs('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'second.student', password: 'Second-student-123' }),
  });
  assert.equal(login.status, 200);
  const secondCookie = login.headers.get('set-cookie').split(';')[0];

  const createNote = await request('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Private test note', content: 'Only the owner should see this.' }),
  });
  assert.equal(createNote.status, 201);
  const otherNotes = await requestAs('/api/notes', {}, secondCookie);
  assert.equal(otherNotes.status, 200);
  assert.deepEqual((await otherNotes.json()).notes, []);

  const attemptedRoleChange = await requestAs('/api/profile', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin', id: 'another-user', name: 'Second Test Student' }),
  }, secondCookie);
  assert.equal(attemptedRoleChange.status, 200);
  assert.equal((await attemptedRoleChange.json()).profile.role, 'student');
  const firstProfile = await request('/api/profile');
  assert.equal((await firstProfile.json()).profile.username, 'retry.student');
});

test('admin exports are private and neutralize spreadsheet formulas from user fields', async () => {
  const signup = await requestAs('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '=HYPERLINK("https://attacker.example","click")', username: 'formula.student', password: 'Formula-student-123', role: 'student', termsAccepted: true }),
  });
  assert.equal(signup.status, 201);
  const login = await requestAs('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.admin@example.test', password: 'Audit-admin-password-123' }),
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const report = await requestAs('/api/admin/reports/export?type=users', {}, adminCookie);
  assert.equal(report.status, 200);
  assert.equal(report.headers.get('cache-control'), 'no-store');
  assert.equal(report.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await report.text(), /"'=HYPERLINK\(""https:\/\/attacker\.example"",""click""\)"/);
});

test('API responses are non-cacheable and frontend shell assets require revalidation', async () => {
  const apiResponse = await request('/api/my-enrollments');
  assert.equal(apiResponse.headers.get('cache-control'), 'no-store');
  const assetResponse = await request('/app.js');
  assert.equal(assetResponse.headers.get('cache-control'), 'no-cache, must-revalidate');
  const securityAsset = await request('/security-utils.js');
  assert.equal(securityAsset.status, 200);
  assert.equal(securityAsset.headers.get('cache-control'), 'no-cache, must-revalidate');
  assert.match(securityAsset.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(securityAsset.headers.get('permissions-policy'), /camera=\(self\)/);
});

test('unknown pages use a branded, non-cacheable HTML 404 and legal pages are served', async () => {
  const missing = await request('/this-page-does-not-exist');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /text\/html/);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  assert.match(await missing.text(), /This page isn’t here/);
  for (const route of ['/.env', '/.env.example', '/backend/data/store.json']) {
    const privateFile = await request(route);
    assert.equal(privateFile.status, 404);
    assert.doesNotMatch(await privateFile.text(), /EDUVERSE_ADMIN_SETUP_CODE|"users"/);
  }
  for (const route of ['/terms.html', '/privacy.html']) {
    const page = await request(route);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache, must-revalidate');
    assert.match(page.headers.get('content-type'), /text\/html/);
  }
});

test('student community supports repeat-safe likes, follows, bookmarks, replies, and moderator reports', async () => {
  const signup = await requestAs('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Community Student', username: 'community.student', password: 'Community-student-123', role: 'student', termsAccepted: true }),
  });
  assert.equal(signup.status, 201);
  const login = await requestAs('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'community.student', password: 'Community-student-123' }),
  });
  assert.equal(login.status, 200);
  const communityCookie = login.headers.get('set-cookie').split(';')[0];
  const profile = await requestAs('/api/profile', {}, communityCookie);
  const communityId = (await profile.json()).profile.id;

  const secondPost = await requestAs('/api/community/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'A question for the study group.' }),
  }, communityCookie);
  assert.equal(secondPost.status, 201);
  const postId = (await secondPost.json()).post.id;

  const follow = () => requestAs(`/api/community/follow/${communityId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }),
  }, cookie);
  assert.deepEqual(await (await follow()).json(), { following: true });
  assert.deepEqual(await (await follow()).json(), { following: true });
  const followingFeed = await request('/api/community/feed?feed=following');
  assert.equal((await followingFeed.json()).posts[0].id, postId);

  const like = () => request(`/api/community/posts/${postId}/like`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }),
  });
  assert.deepEqual(await (await like()).json(), { active: true });
  assert.deepEqual(await (await like()).json(), { active: true });
  const bookmark = () => request(`/api/community/posts/${postId}/bookmark`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }),
  });
  assert.deepEqual(await (await bookmark()).json(), { active: true });
  assert.deepEqual(await (await bookmark()).json(), { active: true });

  const comment = await request(`/api/community/posts/${postId}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Here is a helpful reply.' }),
  });
  assert.equal(comment.status, 201);
  const commentId = (await comment.json()).comment.id;
  const report = await request('/api/community/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType: 'comment', targetId: commentId, reason: 'Spam or promotion' }),
  });
  assert.equal(report.status, 201);

  const adminLogin = await requestAs('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.admin@example.test', password: 'Audit-admin-password-123' }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const reports = await requestAs('/api/admin/community/reports', {}, adminCookie);
  const reportId = (await reports.json()).reports[0].id;
  const hide = await requestAs(`/api/admin/community/reports/${reportId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hide' }),
  }, adminCookie);
  assert.equal(hide.status, 200);
  const feed = await request('/api/community/feed');
  assert.equal((await feed.json()).posts.find(p => p.id === postId).comments.length, 0);
});
