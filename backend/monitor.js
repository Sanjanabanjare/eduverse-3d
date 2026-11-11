'use strict';
/* Error monitoring: Sentry when SENTRY_DSN is set, else stderr + store.errorLog
 * (capped 200, admin-viewable at GET /api/admin/monitoring/errors). */

const crypto = require('node:crypto');

let storeRef = null;
function init(store) { storeRef = store; }

function sentryEnabled() { return !!process.env.SENTRY_DSN; }

function envelopeHeader() {
  const dsn = new URL(process.env.SENTRY_DSN);
  const key = dsn.username;
  const projectId = dsn.pathname.replace(/^\//, '');
  return { dsn: `${dsn.protocol}//${dsn.host}${dsn.pathname}`, key, projectId };
}

async function sendToSentry(err, ctx) {
  const { dsn, key, projectId } = envelopeHeader();
  const eventId = crypto.randomBytes(16).toString('hex');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    level: 'error',
    exception: { values: [{ type: err?.name || 'Error', value: String(err?.message || err).slice(0, 2000), stacktrace: { frames: parseStack(err?.stack) } }] },
    contexts: { app: { app_version: process.env.npm_package_version || '1.1.0' } },
    extra: ctx || {},
  };
  const body = JSON.stringify({ sent_at: new Date().toISOString(), sdk: { name: 'eduverse.monitor', version: '1.0' } })
    + '\n' + JSON.stringify({ type: 'event', event_id: eventId, content_type: 'application/json' })
    + '\n' + JSON.stringify(event);
  const res = await fetch(`${dsn}/api/${projectId}/envelope/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=eduverse.monitor/1.0` },
    body,
  });
  if (!res.ok) throw new Error(`Sentry rejected (${res.status}).`);
}

function parseStack(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n').slice(1, 11)) {
    const m = /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/.exec(line) || /at\s+(.+?):(\d+):(\d+)/.exec(line);
    if (m) frames.push({ function: m[1] || '<anonymous>', filename: m[2] || m[1], lineno: Number(m[3] || m[2]), colno: Number(m[4] || m[3]) });
  }
  return frames.reverse();
}

function logLocally(err, ctx) {
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    message: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || '').slice(0, 2000),
    ctx: ctx && typeof ctx === 'object' ? JSON.parse(JSON.stringify(ctx).slice(0, 2000)) : null,
  };
  console.error('[monitor]', entry.message, ctx ? JSON.stringify(ctx).slice(0, 200) : '');
  if (storeRef) {
    storeRef.errorLog ||= [];
    storeRef.errorLog.unshift(entry);
    if (storeRef.errorLog.length > 200) storeRef.errorLog.length = 200;
  }
  return entry;
}

async function captureError(err, ctx) {
  if (sentryEnabled()) {
    try { await sendToSentry(err, ctx); return { provider: 'sentry' }; }
    catch (e) { /* fall through to local log */ }
  }
  const entry = logLocally(err, ctx);
  return { provider: 'local', id: entry.id };
}

function wrapProcess() {
  process.on('uncaughtException', (err) => { captureError(err, { kind: 'uncaughtException' }); });
  process.on('unhandledRejection', (reason) => { captureError(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandledRejection' }); });
}

module.exports = { init, captureError, wrapProcess, sentryEnabled };
