'use strict';
/**
 * backend/sec.js — security monitoring helpers (Slice C).
 * Holds a reference to the store (injected via init, same pattern as org.js/live.js).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const MAX_EVENTS = 5000;
const BRUTE_FORCE_THRESHOLD = 5;
const BRUTE_FORCE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Append a security event. Collection is capped at MAX_EVENTS (oldest dropped).
 * Returns the event, or null when the store is not initialized.
 */
function logEvent({ institutionId = null, type, severity = 'medium', actor = '', detail = '', ip = '' }) {
  if (!store) return null;
  store.securityEvents ||= [];
  if (!SEVERITIES.includes(severity)) severity = 'medium';
  const ev = {
    id: randomUUID(),
    institutionId: institutionId || null,
    type: String(type || 'unknown').slice(0, 60),
    severity,
    actor: String(actor || '').slice(0, 120),
    detail: String(detail || '').slice(0, 500),
    ip: String(ip || '').slice(0, 60),
    at: new Date().toISOString(),
  };
  store.securityEvents.unshift(ev);
  if (store.securityEvents.length > MAX_EVENTS) store.securityEvents.length = MAX_EVENTS;
  return ev;
}

function recentLoginFails(ip, windowMs) {
  const cutoff = Date.now() - windowMs;
  return (store.securityEvents || []).filter(e =>
    e && e.type === 'login_failed' && e.ip === ip && new Date(e.at || '').getTime() >= cutoff
  ).length;
}

/**
 * Escalate to a brute_force (high) event once per window when an IP crosses
 * the failed-login threshold. Returns true when an escalation was logged.
 */
function checkBruteForce(ip) {
  if (!store || !ip || ip === 'local') return false;
  if (recentLoginFails(ip, BRUTE_FORCE_WINDOW_MS) < BRUTE_FORCE_THRESHOLD) return false;
  const cutoff = Date.now() - BRUTE_FORCE_WINDOW_MS;
  const already = (store.securityEvents || []).some(e =>
    e && e.type === 'brute_force' && e.ip === ip && new Date(e.at || '').getTime() >= cutoff);
  if (already) return false;
  logEvent({
    type: 'brute_force', severity: 'high', actor: '',
    detail: `${BRUTE_FORCE_THRESHOLD}+ failed logins from one IP in 10 minutes`, ip,
  });
  return true;
}

/** Public view of an integration: configSecret is never exposed. */
function redactIntegration(row) {
  if (!row || typeof row !== 'object') return null;
  const { configSecret, ...rest } = row;
  return { ...rest, hasSecret: !!configSecret };
}

module.exports = {
  init, logEvent, checkBruteForce, redactIntegration,
  SEVERITIES, MAX_EVENTS, BRUTE_FORCE_THRESHOLD, BRUTE_FORCE_WINDOW_MS,
};
