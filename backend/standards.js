'use strict';
/**
 * backend/standards.js — LMS integrations (Slice 5):
 *   - LTI 1.1 tool-provider launch (OAuth 1.0a HMAC-SHA1 verification)
 *   - SCORM 1.2/2004 package import (zip -> imsmanifest.xml -> lessons)
 *   - xAPI statement store + internal emits
 * Holds a reference to the store (injected via init, same pattern as
 * org/sec/live/family/library/career/lang). No circular require: server.js
 * requires this file; this file requires nothing from server.js.
 */
const { randomUUID, createHmac, timingSafeEqual, randomBytes } = require('crypto');
const zlib = require('zlib');

let store = null;
function init(s) { store = s; }

function str(v, max) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length <= max ? s : null;
}

/* ------------------------------------------------------------------ */
/* LTI 1.1                                                            */
/* ------------------------------------------------------------------ */

/** Validate an LTI consumer payload. Secrets auto-generated on create. */
function validateLtiConsumer(body, existing) {
  const label = str(body.label !== undefined ? body.label : (existing && existing.label), 120);
  if (label === null || (label !== '' && label.length < 2)) return { ok: false, error: 'Label must be 2 to 120 characters.' };
  const courseId = str(body.courseId !== undefined ? body.courseId : (existing && existing.courseId), 80);
  if (!courseId) return { ok: false, error: 'courseId is required.' };
  const course = (store.courses || []).find(c => c.id === courseId);
  if (!course) return { ok: false, error: 'Course not found.' };
  return { ok: true, value: { label: label || course.title || 'LTI consumer', courseId } };
}

/** Public consumer shape — the secret is NEVER included. */
function publicLtiConsumer(c) {
  return { id: c.id, institutionId: c.institutionId, key: c.key, label: c.label, courseId: c.courseId, createdAt: c.createdAt, launchCount: c.launchCount || 0 };
}

function newLtiCredentials() {
  return {
    key: 'lti_' + randomBytes(8).toString('hex'),
    secret: randomBytes(24).toString('hex'),
  };
}

/** OAuth 1.0a percent-encoding (RFC 3986 — stricter than encodeURIComponent). */
function oauthEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function normalizeLaunchUrl(raw) {
  const u = new URL(raw);
  let out = u.protocol.toLowerCase() + '//' + u.hostname.toLowerCase();
  const port = u.port;
  const isDefault = (u.protocol === 'http:' && port === '80') || (u.protocol === 'https:' && port === '443');
  if (port && !isDefault) out += ':' + port;
  out += u.pathname || '/';
  return out;
}

function oauthSignatureBase(method, url, params) {
  const sorted = Object.keys(params).sort()
    .map(k => oauthEncode(k) + '=' + oauthEncode(params[k]))
    .join('&');
  return [method.toUpperCase(), oauthEncode(normalizeLaunchUrl(url)), oauthEncode(sorted)].join('&');
}

/** Build the OAuth 1.0a signature for a param set (used by tests/consumers). */
function signOAuth1({ method, url, params, consumerSecret }) {
  const base = oauthSignatureBase(method, url, params);
  return createHmac('sha1', oauthEncode(consumerSecret) + '&').update(base).digest('base64');
}

/** Verify an LTI 1.1 launch's OAuth 1.0a signature + timestamp + nonce. */
function verifyLtiLaunch({ method, url, params }) {
  const key = str(params.oauth_consumer_key, 120);
  if (!key) return { ok: false, error: 'Missing oauth_consumer_key.' };
  const consumer = (store.ltiConsumers || []).find(c => c.key === key);
  if (!consumer) return { ok: false, error: 'Unknown consumer key.' };
  if (params.oauth_signature_method && params.oauth_signature_method !== 'HMAC-SHA1')
    return { ok: false, error: 'Only HMAC-SHA1 signatures are supported.' };
  const ts = Number(params.oauth_timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Missing oauth_timestamp.' };
  if (Math.abs(Date.now() / 1000 - ts) > 600)
    return { ok: false, error: 'Launch timestamp is too old or too far in the future.' };
  // Nonce replay guard (10-minute window).
  store.ltiNonces ||= [];
  const cutoff = Date.now() - 10 * 60 * 1000;
  store.ltiNonces = store.ltiNonces.filter(n => n.at > cutoff);
  const nonce = str(params.oauth_nonce, 200);
  if (!nonce) return { ok: false, error: 'Missing oauth_nonce.' };
  if (store.ltiNonces.some(n => n.nonce === nonce && n.key === key))
    return { ok: false, error: 'Duplicate launch (nonce already used).' };
  const copy = { ...params };
  delete copy.oauth_signature;
  const expected = signOAuth1({ method, url, params: copy, consumerSecret: consumer.secret });
  const given = String(params.oauth_signature || '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, error: 'Invalid OAuth signature.' };
  store.ltiNonces.push({ key, nonce, at: Date.now() });
  return { ok: true, consumer };
}

/* ------------------------------------------------------------------ */
/* SCORM                                                              */
/* ------------------------------------------------------------------ */

/** Minimal ZIP reader (stored + deflated entries, via central directory). */
function parseZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('Not a ZIP file.');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file (end-of-central-directory not found).');
  const cdCount = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdCount > 10000) throw new Error('ZIP has too many entries.');
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Corrupt ZIP central directory.');
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({ name, method, compSize, localOffset });
  }
  return entries
    .filter(e => e.name && !e.name.endsWith('/'))
    .map(e => {
      // Path traversal guard.
      const parts = e.name.split(/[\\/]/);
      if (parts.includes('..') || /^[a-zA-Z]:/.test(e.name) || e.name.startsWith('/'))
        throw new Error('ZIP contains an unsafe path: ' + e.name.slice(0, 80));
      const lh = e.localOffset;
      if (lh + 30 > buffer.length || buffer.readUInt32LE(lh) !== 0x04034b50)
        throw new Error('Corrupt ZIP local header.');
      const lhNameLen = buffer.readUInt16LE(lh + 26);
      const lhExtraLen = buffer.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lhNameLen + lhExtraLen;
      const comp = buffer.subarray(dataStart, dataStart + e.compSize);
      let data;
      if (e.method === 0) data = Buffer.from(comp);
      else if (e.method === 8) data = zlib.inflateRawSync(comp);
      else throw new Error('Unsupported ZIP compression method ' + e.method + '.');
      return { name: e.name, data };
    });
}

function stripXmlTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function xmlAttr(attrs, name) {
  const m = String(attrs || '').match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}

/**
 * Parse a SCORM imsmanifest.xml into {title, items:[{identifier,title,href}]}.
 * Regex-based: manifests are machine-generated and this avoids an XML dependency.
 */
function parseScormManifest(xmlText) {
  const text = String(xmlText || '');
  if (!/<manifest[\s>]/i.test(text)) throw new Error('imsmanifest.xml is not a valid SCORM manifest.');
  const orgTitle = text.match(/<organization\b[\s\S]*?<title>([\s\S]*?)<\/title>/i);
  const title = orgTitle ? stripXmlTags(orgTitle[1]).slice(0, 160) : '';
  const resources = {};
  const resRe = /<resource\b([^>]*?)>/gi;
  let m;
  while ((m = resRe.exec(text))) {
    const id = xmlAttr(m[1], 'identifier');
    const href = xmlAttr(m[1], 'href');
    const adlcp = /adlcp:scormtype\s*=\s*["']sco["']/i.test(m[1]);
    if (id && href) resources[id] = { href, sco: adlcp };
  }
  const items = [];
  const itemRe = /<item\b([^>]*?)>([\s\S]*?)<\/item>/gi;
  while ((m = itemRe.exec(text))) {
    const identifier = xmlAttr(m[1], 'identifier');
    const ref = xmlAttr(m[1], 'identifierref');
    const t = m[2].match(/<title>([\s\S]*?)<\/title>/i);
    const res = ref ? resources[ref] : null;
    if (identifier) items.push({
      identifier,
      title: (t ? stripXmlTags(t[1]) : identifier).slice(0, 160) || identifier,
      href: res ? res.href : null,
      sco: !!(res && res.sco),
    });
  }
  if (!items.length) throw new Error('Manifest has no launchable items.');
  return { title, items };
}

/** Public SCORM package shape (manifest XML itself is not returned). */
function publicScormPackage(p) {
  return {
    id: p.id, institutionId: p.institutionId, courseId: p.courseId, title: p.title,
    itemCount: (p.items || []).length,
    items: (p.items || []).map(i => ({ identifier: i.identifier, title: i.title, href: i.href, lessonId: i.lessonId || null })),
    uploadedAt: p.uploadedAt, uploadedBy: p.uploadedBy,
  };
}

/* ------------------------------------------------------------------ */
/* xAPI                                                               */
/* ------------------------------------------------------------------ */

const XAPI_VERBS = {
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
};

/** Validate an xAPI-style statement. Returns {ok, value} or {ok:false, error}. */
function validateXapiStatement(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Statement must be an object.' };
  const actor = body.actor && typeof body.actor === 'object' ? body.actor : {};
  const actorName = str(actor.name, 160);
  const actorMbox = str(actor.mbox, 200);
  const actorAccount = actor.account && typeof actor.account === 'object' ? str(actor.account.name, 200) : str(actor.account, 200);
  if (!actorName && !actorMbox && !actorAccount)
    return { ok: false, error: 'actor needs a name, mbox, or account.' };
  const verb = body.verb && typeof body.verb === 'object' ? body.verb : {};
  const verbId = str(verb.id, 300);
  if (!verbId || !/^https?:\/\//i.test(verbId)) return { ok: false, error: 'verb.id must be an IRI.' };
  const object = body.object && typeof body.object === 'object' ? body.object : {};
  const objectId = str(object.id, 500);
  if (!objectId) return { ok: false, error: 'object.id is required.' };
  const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result) ? body.result : {};
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
  return {
    ok: true,
    value: {
      actor: { ...(actorName ? { name: actorName } : {}), ...(actorMbox ? { mbox: actorMbox } : {}), ...(actorAccount ? { account: { name: actorAccount } } : {}) },
      verb: { id: verbId, display: verb.display && typeof verb.display === 'object' ? verb.display : {} },
      object: { id: objectId, objectType: str(object.objectType, 40) || 'Activity', definition: object.definition && typeof object.definition === 'object' ? object.definition : {} },
      result, context,
    },
  };
}

/**
 * Record an xAPI statement in the store. Used for internal emits (lesson
 * completed, quiz graded) and for externally POSTed statements.
 */
function recordXapiStatement({ institutionId, actor, verb, object, result, context, source }) {
  store.xapiStatements ||= [];
  const st = {
    id: randomUUID(),
    institutionId: institutionId || null,
    actor, verb, object,
    result: result || {},
    context: context || {},
    stored: new Date().toISOString(),
    source: source || 'internal',
  };
  store.xapiStatements.unshift(st);
  if (store.xapiStatements.length > 5000) store.xapiStatements.length = 5000;
  return st;
}

/** Convenience: emit an internal xAPI statement for a user action. */
function emitXapi({ institutionId, user, verbKey, verbDisplay, objectId, objectName, result }) {
  if (!user) return null;
  const verbId = XAPI_VERBS[verbKey] || verbKey;
  return recordXapiStatement({
    institutionId,
    actor: { name: user.name || user.username || '', account: { name: user.username || user.id } },
    verb: { id: verbId, display: verbDisplay ? { 'en-US': verbDisplay } : {} },
    object: { id: String(objectId), objectType: 'Activity', definition: objectName ? { name: { 'en-US': String(objectName).slice(0, 200) } } : {} },
    result: result || {},
    source: 'internal',
  });
}

/* ------------------------------------------------------------------ */
/* Enrollment report rows (shared by CSV/PDF/XLS exports)              */
/* ------------------------------------------------------------------ */

function enrollmentReportRows({ courseId, semesterId, institutionId } = {}) {
  const rows = (store.enrollments || []).map(e => {
    const u = (store.users || []).find(x => x.id === e.studentId) || {};
    const c = (store.courses || []).find(x => x.id === e.courseId) || {};
    return {
      studentId: e.studentId, studentName: u.name || '', username: u.username || '',
      courseId: e.courseId, courseTitle: c.title || '', enrolledAt: e.enrolledAt || '',
      institutionId: c.institutionId || u.institutionId || null,
      semesterId: c.semesterId || null, via: e.via || 'direct',
    };
  }).filter(r =>
    (!courseId || r.courseId === courseId) &&
    (!semesterId || r.semesterId === semesterId) &&
    (!institutionId || r.institutionId === institutionId));
  return rows;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Printable HTML enrollment report (user prints / saves as PDF). */
function enrollmentReportHtml(rows, meta) {
  const cells = rows.map(r =>
    `<tr><td>${escapeHtml(r.studentName)}</td><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.courseTitle)}</td><td>${escapeHtml(r.enrolledAt ? String(r.enrolledAt).slice(0, 10) : '')}</td><td>${escapeHtml(r.via)}</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Enrollment report</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:32px}
h1{font-size:20px;margin:0 0 4px}.meta{color:#555;font-size:12px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #999;padding:6px 8px;text-align:left}
th{background:#eee}
.printbar{margin:0 0 16px}
@media print{.printbar{display:none}body{margin:0}}
</style></head><body>
<div class="printbar"><button onclick="window.print()">Print / save as PDF</button>
<span style="margin-left:12px;color:#555;font-size:12px">This is a print-ready report — use your browser's Print dialog and choose "Save as PDF".</span></div>
<h1>Enrollment report</h1>
<div class="meta">Generated ${escapeHtml(meta.generatedAt)} · ${rows.length} enrollment${rows.length === 1 ? '' : 's'}${meta.institutionName ? ' · ' + escapeHtml(meta.institutionName) : ''}</div>
<table><thead><tr><th>Student</th><th>Username</th><th>Course</th><th>Enrolled</th><th>Via</th></tr></thead>
<tbody>${cells || '<tr><td colspan="5">No enrollments.</td></tr>'}</tbody></table>
</body></html>`;
}

function escapeXml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** SpreadsheetML (.xls) enrollment report — opens in Excel/LibreOffice. */
function enrollmentReportXls(rows) {
  const head = ['Student', 'Username', 'Course', 'Enrolled', 'Via'];
  const dataRows = rows.map(r => [r.studentName, r.username, r.courseTitle, r.enrolledAt ? String(r.enrolledAt).slice(0, 10) : '', r.via]);
  const rowXml = cells => `<Row>${cells.map(c => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`).join('')}</Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Enrollments"><Table>
${rowXml(head)}
${dataRows.map(rowXml).join('\n')}
</Table></Worksheet></Workbook>`;
}

module.exports = {
  init,
  validateLtiConsumer, publicLtiConsumer, newLtiCredentials,
  verifyLtiLaunch, signOAuth1, oauthSignatureBase,
  parseZip, parseScormManifest, publicScormPackage,
  XAPI_VERBS, validateXapiStatement, recordXapiStatement, emitXapi,
  enrollmentReportRows, enrollmentReportHtml, enrollmentReportXls,
};
