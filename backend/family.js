'use strict';
/**
 * backend/family.js — parent portal helpers (Slice 1: parent portal + announcements).
 * Holds a reference to the store (injected via init, same pattern as org/sec/live).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 */
const { randomUUID, randomBytes } = require('crypto');

let store = null;
function init(s) { store = s; }

const RELATIONS = ['father', 'mother', 'guardian', 'other'];

/** 8-char link code: unambiguous uppercase alphanumerics. */
function genLinkCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

/** Aggregate progress for a student: enrollments, completion, quiz scores, XP/level. */
function childProgress(studentId) {
  const enrollments = (store.enrollments || []).filter(e => e.studentId === studentId);
  let completed = 0;
  for (const e of enrollments) {
    const course = (store.courses || []).find(c => c.id === e.courseId);
    const total = (course?.modules || []).reduce((n, m) => n + ((m.lessons || []).length || 1), 0) || 1;
    const done = (store.courseLessonProgress[`${studentId}:${e.courseId}`] || []).length;
    if (done >= total) completed++;
  }
  const graded = (store.quizAttempts || []).filter(a => a.studentId === studentId && a.status === 'graded');
  const avgQuizScore = graded.length
    ? Math.round(graded.reduce((n, a) => n + (Number(a.finalScore) || 0), 0) / graded.length)
    : null;
  const xpRec = (store.userXp || {})[studentId] || { xp: 0, level: 1 };
  return {
    coursesEnrolled: enrollments.length,
    coursesCompleted: completed,
    avgQuizScore,
    xp: xpRec.xp || 0,
    level: xpRec.level || 1,
  };
}

/**
 * Aggregate attendance for a student.
 * Sources: live session attendance[] entries ({userId}) + class attendance records
 * (teacherWorkspaces[].attendance[].attendance[] rows {studentId, status}).
 */
function childAttendance(studentId) {
  let present = 0, total = 0;
  for (const s of store.liveSessions || []) {
    for (const a of s.attendance || []) {
      if (a.userId === studentId) { total++; present++; }
    }
  }
  for (const w of Object.values(store.teacherWorkspaces || {})) {
    for (const rec of w.attendance || []) {
      for (const row of rec.attendance || []) {
        if (row.studentId === studentId) {
          total++;
          if (row.status === 'present' || row.status === 'late') present++;
        }
      }
    }
  }
  return { present, total };
}

/** Recent graded quiz attempts for a student (newest first, capped). */
function childResults(studentId, limit = 10) {
  return (store.quizAttempts || [])
    .filter(a => a.studentId === studentId && a.status === 'graded')
    .sort((a, b) => String(b.submittedAt || b.createdAt || '').localeCompare(String(a.submittedAt || a.createdAt || '')))
    .slice(0, limit)
    .map(a => {
      const quiz = (store.quizzes || []).find(q => q.id === a.quizId) || {};
      return {
        attemptId: a.id, quizId: a.quizId, quizTitle: quiz.title || 'Quiz',
        score: a.finalScore ?? null, passed: !!a.passed,
        submittedAt: a.submittedAt || a.createdAt || null,
      };
    });
}

/** Certificates earned by a student (newest first). */
function childCertificates(studentId) {
  return (store.certificates || [])
    .filter(c => c.userId === studentId)
    .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))
    .map(c => ({ id: c.id, code: c.code, courseId: c.courseId, courseTitle: c.courseTitle, issuedAt: c.issuedAt, scoreAvg: c.scoreAvg ?? null }));
}

/** All students linked to a parent. */
function childrenOf(parentId) {
  return (store.parentLinks || [])
    .filter(l => l.parentId === parentId)
    .map(l => (store.users || []).find(u => u.id === l.studentId && u.role === 'student'))
    .filter(Boolean);
}

module.exports = {
  init, genLinkCode, childProgress, childAttendance, childResults, childCertificates,
  childrenOf, RELATIONS,
};
