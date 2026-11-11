'use strict';
/**
 * backend/library.js — library + offline learning helpers (Slice 2).
 * Holds a reference to the store (injected via init, same pattern as org/sec/live/family).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

const KINDS = ['book', 'ebook', 'journal'];
const LOAN_DAYS = 14;

/** Validate a library item payload. Returns {ok, item} or {ok:false, error}. */
function validateItem(body, existing) {
  const kind = String(body.kind || (existing && existing.kind) || '').toLowerCase();
  if (!KINDS.includes(kind)) return { ok: false, error: 'Kind must be one of: ' + KINDS.join(', ') + '.' };
  const title = String(body.title !== undefined ? body.title : (existing && existing.title) || '').trim();
  if (title.length < 2 || title.length > 200) return { ok: false, error: 'Title must be 2 to 200 characters.' };
  const author = String(body.author !== undefined ? body.author : (existing && existing.author) || '').trim();
  if (author.length > 120) return { ok: false, error: 'Author must be 120 characters or fewer.' };
  const isbn = String(body.isbn !== undefined ? body.isbn : (existing && existing.isbn) || '').trim();
  if (isbn && !/^[0-9Xx-]{4,20}$/.test(isbn)) return { ok: false, error: 'ISBN looks invalid (digits, X and hyphens, 4 to 20 chars).' };
  const subject = String(body.subject !== undefined ? body.subject : (existing && existing.subject) || '').trim();
  if (subject.length > 80) return { ok: false, error: 'Subject must be 80 characters or fewer.' };
  const description = String(body.description !== undefined ? body.description : (existing && existing.description) || '').trim();
  if (description.length > 2000) return { ok: false, error: 'Description must be 2,000 characters or fewer.' };
  const fileUrl = String(body.fileUrl !== undefined ? body.fileUrl : (existing && existing.fileUrl) || '').trim();
  if (fileUrl && !(/^https:\/\//.test(fileUrl) || fileUrl.startsWith('/')) || fileUrl.length > 2000)
    return { ok: false, error: 'File URL must be an https URL or site path.' };
  if (kind === 'ebook' && !fileUrl && !existing) return { ok: false, error: 'E-books need a file URL (upload via /api/upload first).' };
  const coverUrl = String(body.coverUrl !== undefined ? body.coverUrl : (existing && existing.coverUrl) || '').trim();
  if (coverUrl && !(/^https:\/\//.test(coverUrl) || coverUrl.startsWith('/')) || coverUrl.length > 2000)
    return { ok: false, error: 'Cover URL must be an https URL or site path.' };
  let totalCopies = existing ? existing.totalCopies : null;
  if (body.totalCopies !== undefined) {
    totalCopies = Math.floor(Number(body.totalCopies));
    if (!Number.isInteger(totalCopies) || totalCopies < 0 || totalCopies > 10000)
      return { ok: false, error: 'Total copies must be 0 to 10,000.' };
  }
  if (kind === 'book' && (totalCopies === null || totalCopies < 1))
    return { ok: false, error: 'Physical books need at least 1 copy.' };
  return { ok: true, value: { kind, title, author, isbn, subject, description, fileUrl, coverUrl, totalCopies } };
}

/** Public shape of a library item (adds computed availability for books). */
function publicItem(item) {
  const activeLoans = (store.bookLoans || []).filter(l => l.itemId === item.id && !l.returnedAt).length;
  const out = {
    id: item.id, institutionId: item.institutionId || null, kind: item.kind,
    title: item.title, author: item.author || '', isbn: item.isbn || '',
    subject: item.subject || '', description: item.description || '',
    fileUrl: item.fileUrl || null, coverUrl: item.coverUrl || null,
    createdAt: item.createdAt,
  };
  if (item.kind === 'book') {
    out.totalCopies = item.totalCopies || 0;
    out.availableCopies = Math.max(0, (item.totalCopies || 0) - activeLoans);
    out.activeLoans = activeLoans;
  }
  return out;
}

/** A loan is overdue when not returned and past dueAt. */
function isOverdue(loan) {
  return !loan.returnedAt && Number(new Date(loan.dueAt).getTime()) < Date.now();
}

/** Enrich a loan with its item + overdue flag. */
function publicLoan(loan) {
  const item = (store.libraryItems || []).find(i => i.id === loan.itemId) || {};
  return {
    id: loan.id, itemId: loan.itemId, studentId: loan.studentId,
    borrowedAt: loan.borrowedAt, dueAt: loan.dueAt, returnedAt: loan.returnedAt || null,
    overdue: isOverdue(loan),
    itemTitle: item.title || 'Removed item', itemKind: item.kind || 'book',
  };
}

/** Find the course (and module) containing a lessonId. Lessons live in course.modules[].lessons[]. */
function findLessonCourse(lessonId) {
  for (const c of store.courses || []) {
    for (const m of c.modules || []) {
      if ((m.lessons || []).some(l => l.id === lessonId)) return c;
    }
  }
  return null;
}

module.exports = {
  init, KINDS, LOAN_DAYS, validateItem, publicItem, publicLoan, isOverdue, findLessonCourse,
};
