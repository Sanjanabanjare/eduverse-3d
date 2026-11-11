'use strict';
/**
 * backend/career.js — calendar + career center + placement prep helpers (Slice 3).
 * Holds a reference to the store (injected via init, same pattern as org/sec/live/family/library).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 *
 * NOTE on derived calendar events: the contract mentions deriving events from
 * `exams[]` and quiz deadlines. This codebase has no `exams[]` collection —
 * advanced exams are quizzes (see backend/exam.js), and quizzes carry no
 * deadline/date field. The only date-bearing scheduled items are live sessions
 * (`startsAt`). So the unified calendar derives events from live sessions only;
 * exams go on the calendar as stored events (kind 'exam') created by admins.
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

const EVENT_KINDS = ['holiday', 'exam', 'deadline', 'event'];
const MOCK_KINDS = ['hr', 'technical'];
const MOCK_STATUSES = ['open', 'scheduled', 'done'];

function validIsoDate(v) {
  const t = new Date(String(v || '')).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function str(v, max) {
  const s = String(v ?? '').trim();
  return s.length <= max ? s : null;
}

/** Validate a calendar event payload. Returns {ok, value} or {ok:false, error}. */
function validateCalendarEvent(body, existing) {
  const kind = String(body.kind || (existing && existing.kind) || '').toLowerCase();
  if (!EVENT_KINDS.includes(kind)) return { ok: false, error: 'Kind must be one of: ' + EVENT_KINDS.join(', ') + '.' };
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 200);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 200 characters.' };
  const startsAt = validIsoDate(body.startsAt !== undefined ? body.startsAt : (existing && existing.startsAt));
  if (!startsAt) return { ok: false, error: 'Provide a valid start date/time.' };
  let endsAt = null;
  if (body.endsAt !== undefined && body.endsAt !== null && String(body.endsAt).trim() !== '') {
    endsAt = validIsoDate(body.endsAt);
    if (!endsAt) return { ok: false, error: 'Provide a valid end date/time.' };
  } else if (existing && existing.endsAt) endsAt = existing.endsAt;
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime())
    return { ok: false, error: 'End must not be before start.' };
  const description = str(body.description !== undefined ? body.description : (existing && existing.description), 2000);
  if (description === null) return { ok: false, error: 'Description must be 2,000 characters or fewer.' };
  return { ok: true, value: { kind, title, startsAt, endsAt, description } };
}

/** Validate a career path payload. */
function validateCareerPath(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const description = str(body.description !== undefined ? body.description : (existing && existing.description), 2000);
  if (description === null) return { ok: false, error: 'Description must be 2,000 characters or fewer.' };
  let skills = existing ? (existing.skills || []) : [];
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || body.skills.length > 20) return { ok: false, error: 'Skills must be an array of up to 20 items.' };
    skills = body.skills.map(s => String(s).trim()).filter(Boolean).slice(0, 20);
    if (skills.some(s => s.length > 40)) return { ok: false, error: 'Each skill must be 40 characters or fewer.' };
  }
  let courses = existing ? (existing.courses || []) : [];
  if (body.courses !== undefined) {
    if (!Array.isArray(body.courses)) return { ok: false, error: 'Courses must be an array of course ids.' };
    courses = body.courses.map(String).slice(0, 30);
    const missing = courses.filter(id => !(store.courses || []).some(c => c.id === id));
    if (missing.length) return { ok: false, error: 'Unknown course id: ' + missing[0] };
  }
  return { ok: true, value: { title, description, skills, courses } };
}

function validApplyUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('/')) return s.slice(0, 500);
  if (/^https:\/\//.test(s) && s.length <= 2000) return s;
  return null;
}

/** Validate an internship payload. */
function validateInternship(body, existing) {
  const g = (k, dflt) => body[k] !== undefined ? body[k] : (existing ? existing[k] : dflt);
  const company = str(g('company'), 120);
  if (!company || company.length < 2) return { ok: false, error: 'Company must be 2 to 120 characters.' };
  const role = str(g('role'), 120);
  if (!role || role.length < 2) return { ok: false, error: 'Role must be 2 to 120 characters.' };
  const description = str(g('description'), 2000);
  if (description === null) return { ok: false, error: 'Description must be 2,000 characters or fewer.' };
  const location = str(g('location'), 120);
  if (location === null) return { ok: false, error: 'Location must be 120 characters or fewer.' };
  const stipend = str(g('stipend'), 80);
  if (stipend === null) return { ok: false, error: 'Stipend must be 80 characters or fewer.' };
  const applyUrl = validApplyUrl(g('applyUrl'));
  if (applyUrl === null) return { ok: false, error: 'Apply URL must be an https URL or site path.' };
  let deadline = null;
  if (body.deadline !== undefined && body.deadline !== null && String(body.deadline).trim() !== '') {
    deadline = validIsoDate(body.deadline);
    if (!deadline) return { ok: false, error: 'Provide a valid application deadline.' };
  } else if (existing && existing.deadline) deadline = existing.deadline;
  return { ok: true, value: { company, role, description, location, stipend, applyUrl, deadline } };
}

/** Validate one aptitude question: {q, choices[2..6], answer (index)}. */
function validateAptitudeQuestion(q, i) {
  if (!q || typeof q !== 'object') return `Question ${i + 1}: must be an object.`;
  const text = String(q.q || '').trim();
  if (text.length < 2 || text.length > 500) return `Question ${i + 1}: text must be 2 to 500 characters.`;
  const choices = Array.isArray(q.choices) ? q.choices.map(c => String(c).trim()) : [];
  if (choices.length < 2 || choices.length > 6) return `Question ${i + 1}: give 2 to 6 choices.`;
  if (choices.some(c => !c || c.length > 200)) return `Question ${i + 1}: each choice must be 1 to 200 characters.`;
  const answer = Math.floor(Number(q.answer));
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length)
    return `Question ${i + 1}: answer must be a valid choice index.`;
  return null;
}

/** Validate an aptitude test payload. */
function validateAptitudeTest(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  let questions = existing ? (existing.questions || []) : null;
  if (body.questions !== undefined || !existing) {
    const raw = Array.isArray(body.questions) ? body.questions : [];
    if (raw.length < 1 || raw.length > 100) return { ok: false, error: 'Give 1 to 100 questions.' };
    for (let i = 0; i < raw.length; i++) {
      const err = validateAptitudeQuestion(raw[i], i);
      if (err) return { ok: false, error: err };
    }
    questions = raw.map(q => ({ id: randomUUID(), q: String(q.q).trim(), choices: q.choices.map(c => String(c).trim()), answer: Math.floor(Number(q.answer)) }));
  }
  let timeMin = existing ? existing.timeMin : 30;
  if (body.timeMin !== undefined) {
    timeMin = Math.floor(Number(body.timeMin));
    if (!Number.isInteger(timeMin) || timeMin < 1 || timeMin > 300) return { ok: false, error: 'Time limit must be 1 to 300 minutes.' };
  }
  return { ok: true, value: { title, questions, timeMin } };
}

/** Public shape of an aptitude test: answers NEVER included. */
function publicAptitudeTest(t, withAnswers) {
  const out = {
    id: t.id, institutionId: t.institutionId || null, title: t.title,
    timeMin: t.timeMin || 30, questionCount: (t.questions || []).length,
    createdBy: t.createdBy || null, createdAt: t.createdAt,
  };
  if (withAnswers) out.questions = t.questions || [];
  return out;
}

/** Questions safe to send to a student: id, q, choices only. */
function publicTestQuestions(t) {
  return (t.questions || []).map(q => ({ id: q.id, q: q.q, choices: q.choices }));
}

/** Grade an aptitude attempt. Returns {score, total, correct}. */
function gradeAptitude(test, answers) {
  let correct = 0;
  const total = (test.questions || []).length;
  for (const q of test.questions || []) {
    const given = answers && answers[q.id] !== undefined ? Math.floor(Number(answers[q.id])) : -1;
    if (given === q.answer) correct++;
  }
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { score, total, correct, passed: score >= 50 };
}

/** Validate a mock interview payload. */
function validateMockInterview(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const kind = String(body.kind || (existing && existing.kind) || 'hr').toLowerCase();
  if (!MOCK_KINDS.includes(kind)) return { ok: false, error: 'Kind must be one of: ' + MOCK_KINDS.join(', ') + '.' };
  let questions = existing ? (existing.questions || []) : [];
  if (body.questions !== undefined || !existing) {
    const raw = Array.isArray(body.questions) ? body.questions : [];
    if (raw.length < 1 || raw.length > 30) return { ok: false, error: 'Give 1 to 30 interview questions.' };
    questions = raw.map(q => String(q).trim()).filter(Boolean);
    if (questions.length !== raw.length) return { ok: false, error: 'Questions must be non-empty strings.' };
    if (questions.some(q => q.length > 500)) return { ok: false, error: 'Each question must be 500 characters or fewer.' };
  }
  let scheduledFor = existing ? (existing.scheduledFor || null) : null;
  if (body.scheduledFor !== undefined) {
    if (body.scheduledFor === null || String(body.scheduledFor).trim() === '') scheduledFor = null;
    else {
      scheduledFor = validIsoDate(body.scheduledFor);
      if (!scheduledFor) return { ok: false, error: 'Provide a valid scheduled date/time.' };
    }
  }
  return { ok: true, value: { title, kind, questions, scheduledFor } };
}

/**
 * Derived calendar events from live sessions for the requesting user.
 * Role-filtered: students only see course sessions for courses they are
 * enrolled in; courseless sessions are open to everyone.
 */
function derivedEvents(user, fromMs, toMs) {
  const out = [];
  const enrolled = new Set((store.enrollments || []).filter(e => e.studentId === user.id).map(e => e.courseId));
  for (const s of store.liveSessions || []) {
    const startMs = new Date(s.startsAt || '').getTime();
    if (!Number.isFinite(startMs)) continue;
    if (fromMs && startMs < fromMs) continue;
    if (toMs && startMs > toMs) continue;
    const scope = org_scope_institutionId(s, user);
    if (!scope) continue;
    if (user.role === 'student' && s.courseId && !enrolled.has(s.courseId)) continue;
    const endMs = startMs + (Number(s.durationMin) || 60) * 60000;
    out.push({
      id: 'live:' + s.id, source: 'live', kind: 'event',
      title: s.title || 'Live session',
      description: String(s.description || '').slice(0, 500),
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      courseId: s.courseId || null,
    });
  }
  return out;
}

/** Institution check for derived events: null scope (super admin) or matching institution. */
function org_scope_institutionId(session, user) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  const owner = (store.users || []).find(u => u.id === session.ownerId);
  const instId = (owner && owner.institutionId) || null;
  return !user.institutionId || !instId || user.institutionId === instId;
}

module.exports = {
  init, EVENT_KINDS, MOCK_KINDS, MOCK_STATUSES,
  validateCalendarEvent, validateCareerPath, validateInternship,
  validateAptitudeTest, validateAptitudeQuestion, publicAptitudeTest,
  publicTestQuestions, gradeAptitude, validateMockInterview, derivedEvents,
};
