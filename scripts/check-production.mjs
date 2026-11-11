#!/usr/bin/env node
'use strict';
/**
 * EduVerse 3D — production pre-flight check.
 * Usage: node scripts/check-production.mjs   (or: npm run check:prod)
 * Exits 0 when deployable, non-zero with readable errors.
 * Makes no writes and does not start the server.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const errors = [];
const warnings = [];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

// 1. Node >= 18 (matches package.json engines).
const major = Number.parseInt(String(process.versions.node).split('.')[0], 10);
if (!Number.isFinite(major) || major < 18) {
  errors.push(`Node ${process.versions.node} is too old — EduVerse requires Node >= 18.`);
}

// 2. Production secrets.
if (isProd) {
  if (String(process.env.JWT_SECRET || '').length < 32) {
    errors.push('NODE_ENV=production requires JWT_SECRET with at least 32 characters.');
  }
  const base = String(process.env.APP_BASE_URL || '').trim();
  let baseOk = false;
  let baseHttps = false;
  try {
    const u = new URL(base);
    baseOk = ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
    baseHttps = u.protocol === 'https:';
  } catch { baseOk = false; }
  if (!baseOk) {
    errors.push('NODE_ENV=production requires APP_BASE_URL to be a valid absolute http(s) URL without credentials.');
  } else if (!baseHttps) {
    errors.push('NODE_ENV=production requires APP_BASE_URL to use HTTPS.');
  }
  const setupCode = process.env.EDUVERSE_ADMIN_SETUP_CODE;
  if (setupCode !== undefined && setupCode.length < 32) {
    errors.push('EDUVERSE_ADMIN_SETUP_CODE must be at least 32 characters when set in production.');
  }
  if (setupCode === undefined) {
    warnings.push('EDUVERSE_ADMIN_SETUP_CODE is not set — the 123456 default is refused in production, so first-admin browser setup will not work. Set a 32+ character code or create the first admin another way.');
  }
} else {
  warnings.push('NODE_ENV is not "production" — production checks for JWT_SECRET / APP_BASE_URL / EDUVERSE_ADMIN_SETUP_CODE were skipped.');
}

// 3. Data directory exists and is writable (no writes made by this check).
const storePath = process.env.EDUVERSE_STORE_PATH || path.join(projectRoot, 'backend', 'data', 'store.json');
const dataDir = path.dirname(storePath);
try {
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch (e) {
  if (e.code === 'ENOENT') {
    warnings.push(`Data directory ${dataDir} does not exist yet — the server creates it on first boot; make sure its parent is writable.`);
  } else {
    errors.push(`Data directory ${dataDir} is not writable: ${e.message}`);
  }
}

// 4. Port is free.
const port = Number(process.env.PORT || 4173);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  errors.push(`PORT must be a number between 1 and 65535 (got ${String(process.env.PORT || '')}).`);
} else {
  await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (e) => { errors.push(`Port ${port} is not free: ${e.message}`); resolve(); });
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}

// 5. .env must not be committed (skip silently when there is no git repo).
if (fs.existsSync(path.join(projectRoot, '.git'))) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '.env'], { cwd: projectRoot, stdio: 'pipe' });
    errors.push('.env is tracked in git — remove it from version control (it may contain real secrets).');
  } catch (e) {
    // git exits 1 when the file is not tracked — that is what we want.
    if (e.status !== 1) warnings.push('Could not verify whether .env is tracked in git — check manually.');
  }
}

for (const w of warnings) console.log(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  console.error(`\ncheck-production: ${errors.length} problem(s) found — not deployable.`);
  process.exit(1);
}
console.log(`check-production: OK — deployable${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}.`);
