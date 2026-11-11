'use strict';
/**
 * backend/ops.js — operations helpers (Slice B: fees, marketplace, import, reports).
 * Pure functions only; server.js injects the store via init (same pattern as org.js/live.js).
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

/** Minimal CSV parser: handles quoted fields, commas, escaped quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  return { headers, rows: rows.slice(1) };
}

/** Effective fee-record status: overdue is computed, never stored. */
function feeStatus(rec) {
  if (rec.amountPaid >= rec.amountDue) return 'paid';
  if (rec.dueDate && new Date(rec.dueDate).getTime() < Date.now()) return 'overdue';
  if (rec.amountPaid > 0) return 'partial';
  return 'pending';
}

function validMoney(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? n : null;
}

function validateFeeStructure(body) {
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 120) return { error: 'Fee name must be 2 to 120 characters.' };
  const amount = validMoney(body.amount);
  if (amount === null || amount <= 0) return { error: 'Amount must be a positive number (paise).' };
  const dueMs = new Date(String(body.dueDate || '')).getTime();
  if (!Number.isFinite(dueMs)) return { error: 'Provide a valid due date.' };
  return { value: { name, amount, dueDate: new Date(dueMs).toISOString(), grade: String(body.grade || '').slice(0, 50) || null } };
}

function validatePlan(body) {
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 120) return { error: 'Plan name must be 2 to 120 characters.' };
  const price = validMoney(body.price);
  if (price === null) return { error: 'Price must be a non-negative number (paise).' };
  const billingCycle = String(body.billingCycle || 'monthly');
  if (!['monthly', 'yearly'].includes(billingCycle)) return { error: 'Billing cycle must be monthly or yearly.' };
  const maxStudents = Math.floor(Number(body.maxStudents));
  const maxTeachers = Math.floor(Number(body.maxTeachers));
  if (!Number.isInteger(maxStudents) || maxStudents < 0 || maxStudents > 1000000) return { error: 'maxStudents must be 0 to 1,000,000.' };
  if (!Number.isInteger(maxTeachers) || maxTeachers < 0 || maxTeachers > 100000) return { error: 'maxTeachers must be 0 to 100,000.' };
  const features = Array.isArray(body.features) ? body.features.map(f => String(f).slice(0, 200)).filter(Boolean).slice(0, 20) : [];
  return { value: { name, price, currency: 'INR', billingCycle, maxStudents, maxTeachers, features } };
}

function subscriptionEndsAt(startsAt, billingCycle) {
  const d = new Date(startsAt);
  d.setFullYear(d.getFullYear() + (billingCycle === 'yearly' ? 1 : 0));
  d.setMonth(d.getMonth() + (billingCycle === 'monthly' ? 1 : 0));
  return d.toISOString();
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Validate one bulk-import row. Returns {error} or {value}. */
function validateImportRow(cells, headers, existingUsernames, existingEmails) {
  const get = (k) => {
    const i = headers.indexOf(k);
    return i >= 0 ? String(cells[i] || '').trim() : '';
  };
  const name = get('name');
  const username = get('username').toLowerCase();
  const email = get('email').toLowerCase();
  const password = String(cells[headers.indexOf('password')] || '');
  if (name.length < 2 || name.length > 80) return { error: 'Name must be 2 to 80 characters.' };
  if (!USERNAME_RE.test(username)) return { error: 'Username must be 3–30 letters/numbers/dots/underscores/hyphens.' };
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'Enter a valid email address.' };
  if (password.length < 12 || password.length > 256) return { error: 'Password must be 12 to 256 characters.' };
  if (existingUsernames.has(username)) return { error: 'Username is already in use.' };
  if (existingEmails.has(email)) return { error: 'Email is already linked to an account.' };
  return { value: { name, username, email, password, grade: get('grade').slice(0, 50), section: get('section').slice(0, 30) } };
}

module.exports = {
  init, parseCsv, feeStatus, validMoney, validateFeeStructure, validatePlan,
  subscriptionEndsAt, validateImportRow,
};
