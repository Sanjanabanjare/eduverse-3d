'use strict';
/* File storage abstraction: local disk by default, S3-compatible when env is set.
 * Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION (default us-east-1),
 *      S3_PUBLIC_BASE (optional public URL prefix; else endpoint/bucket/key).
 * No new npm deps — S3 uses hand-rolled SigV4 over fetch. */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/vtt', 'text/plain',
]);

function provider() {
  if (process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) return 's3';
  return 'local';
}

function safeExt(mimeType, filename) {
  const fromName = String(filename || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/vtt': 'vtt', 'text/plain': 'txt' };
  return map[mimeType] || (fromName && fromName.length <= 5 ? fromName : 'bin');
}

function validate(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return 'File data must be a buffer.';
  if (buffer.length === 0) return 'File is empty.';
  if (buffer.length > MAX_BYTES) return 'File exceeds the 5MB limit.';
  if (!ALLOWED_MIME.has(mimeType)) return `Mimetype ${mimeType} is not allowed.`;
  return null;
}

/* ---- SigV4 (hand-rolled, minimal) ---- */
function sha256Hex(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

function signS3Request({ method, url, body, contentType }) {
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const u = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || '');
  const headers = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${String(headers[k]).trim()}\n`).join('');
  const canonicalRequest = [method, u.pathname, u.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { Authorization: auth, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
}

async function s3Put(key, buffer, mimeType) {
  const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, '');
  const bucket = process.env.S3_BUCKET;
  const url = `${endpoint}/${bucket}/${key}`;
  const signed = signS3Request({ method: 'PUT', url, body: buffer, contentType: mimeType });
  const res = await fetch(url, { method: 'PUT', headers: { ...signed, 'Content-Type': mimeType }, body: buffer });
  if (!res.ok) throw new Error(`S3 upload failed (${res.status}).`);
  const base = (process.env.S3_PUBLIC_BASE || `${endpoint}/${bucket}`).replace(/\/$/, '');
  return `${base}/${key}`;
}

async function s3Get(key) {
  const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, '');
  const bucket = process.env.S3_BUCKET;
  const url = `${endpoint}/${bucket}/${key}`;
  const signed = signS3Request({ method: 'GET', url });
  const res = await fetch(url, { method: 'GET', headers: signed });
  if (!res.ok) throw new Error(`S3 fetch failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function s3Delete(key) {
  const endpoint = process.env.S3_ENDPOINT.replace(/\/$/, '');
  const bucket = process.env.S3_BUCKET;
  const url = `${endpoint}/${bucket}/${key}`;
  const signed = signS3Request({ method: 'DELETE', url });
  const res = await fetch(url, { method: 'DELETE', headers: signed });
  if (!res.ok && res.status !== 204) throw new Error(`S3 delete failed (${res.status}).`);
}

/* ---- Public API ---- */
async function saveFile({ buffer, mimeType, folder, filename }) {
  const err = validate(buffer, mimeType);
  if (err) throw new Error(err);
  const cleanFolder = String(folder || 'misc').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'misc';
  const key = `${cleanFolder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${safeExt(mimeType, filename)}`;
  if (provider() === 's3') {
    const url = await s3Put(key, buffer, mimeType);
    return { url, path: key, provider: 's3' };
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, path.basename(key)), buffer, { mode: 0o600 });
  // store folder prefix in filename mapping via sidecar? Keep it simple: flat dir, key recorded by caller.
  return { url: `/uploads/${path.basename(key)}`, path: key, provider: 'local' };
}

async function getFile(filePath) {
  const key = String(filePath || '');
  if (!key || key.includes('..')) throw new Error('Invalid file path.');
  if (provider() === 's3') return s3Get(key);
  return fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(key)));
}

async function deleteFile(filePath) {
  const key = String(filePath || '');
  if (!key || key.includes('..')) throw new Error('Invalid file path.');
  if (provider() === 's3') return s3Delete(key);
  await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(key))).catch(() => {});
}

module.exports = { provider, saveFile, getFile, deleteFile, MAX_BYTES, UPLOAD_DIR };
