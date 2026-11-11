'use strict';
/**
 * backend/exam.js — advanced examination helpers for EduVerse slice 1.
 *
 * - runCodeTests(code, testCases): executes student JavaScript in a node:vm
 *   sandbox (2s timeout, no require/process/network). Protocol: the student's
 *   code must define `function solve(input)`; each test case calls
 *   solve(input) and compares String(result).trim() to expectedOutput.trim().
 *   console.log output is captured and used as a fallback when solve() is
 *   missing or returns undefined.
 * - isAttemptExpired(quiz, attempt, nowMs): server-side time enforcement with
 *   a 30s grace window. Pure function so it is unit-testable.
 */

const vm = require('node:vm');

const CODE_TIMEOUT_MS = 2000;
const MAX_CODE_LEN = 20000;

/** Code-runner kill switch (deploy readiness): CODE_EXEC_ENABLED=false
 *  disables all code execution. Default (unset / anything else): enabled. */
function codeExecEnabled() {
  return String(process.env.CODE_EXEC_ENABLED || '').trim().toLowerCase() !== 'false';
}
const CODE_EXEC_DISABLED_NOTE = 'Code execution is disabled on this server.';

function runCodeTests(code, testCases) {
  const cases = Array.isArray(testCases) ? testCases : [];
  if (!codeExecEnabled()) {
    // Kill switch: never execute student code. Every case scores 0 with a
    // clear note, so the attempt still submits and grades instead of crashing.
    const results = cases.map(tc => ({
      input: String((tc && tc.input) ?? ''),
      expectedOutput: String((tc && tc.expectedOutput) ?? '').trim(),
      actualOutput: '',
      passed: false,
      points: Number(tc && tc.points) || 0,
      error: CODE_EXEC_DISABLED_NOTE,
    }));
    return { results, earned: 0, total: results.reduce((n, r) => n + r.points, 0) };
  }
  const results = [];
  let earned = 0, total = 0;
  const src = String(code || '').slice(0, MAX_CODE_LEN);
  for (const tc of cases) {
    const points = Number(tc && tc.points) || 0;
    total += points;
    const expected = String((tc && tc.expectedOutput) ?? '').trim();
    const input = String((tc && tc.input) ?? '');
    const entry = { input, expectedOutput: expected, actualOutput: '', passed: false, points, error: null };
    try {
      const logs = [];
      const sandbox = {
        __input: input,
        __logs: logs,
        console: { log: (...a) => logs.push(a.map(x => String(x)).join(' ')) },
        result: undefined,
      };
      // Wrap: student code runs first, then we invoke solve(__input).
      const wrapped = `${src}\n;__result = (typeof solve === 'function') ? solve(__input) : undefined;`;
      sandbox.__result = undefined;
      vm.createContext(sandbox);
      vm.runInContext(wrapped, sandbox, { timeout: CODE_TIMEOUT_MS, displayErrors: true });
      const raw = sandbox.__result === undefined || sandbox.__result === null
        ? logs.join('\n')
        : String(sandbox.__result);
      entry.actualOutput = raw.trim().slice(0, 4000);
      entry.passed = entry.actualOutput === expected;
      if (entry.passed) earned += points;
    } catch (err) {
      entry.error = /timed out/i.test(String(err && err.message))
        ? 'Time limit exceeded (2s).'
        : String((err && err.message) || err).slice(0, 300);
    }
    results.push(entry);
  }
  return { results, earned, total };
}

/**
 * True when an in-progress attempt has run past its limit (with 30s grace).
 * quiz: {timeLimitMin}; attempt: {startedAt (ISO)}; nowMs defaults to Date.now().
 */
function isAttemptExpired(quiz, attempt, nowMs) {
  const limitMin = Number(quiz && quiz.timeLimitMin) || 0;
  if (limitMin <= 0) return false;
  const started = new Date(attempt && attempt.startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - started > limitMin * 60000 + 30000;
}

module.exports = { runCodeTests, isAttemptExpired, CODE_TIMEOUT_MS, codeExecEnabled, CODE_EXEC_DISABLED_NOTE };
