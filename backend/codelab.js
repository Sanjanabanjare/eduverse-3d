'use strict';
/**
 * backend/codelab.js — online coding lab helpers (classroom/assignments/coding round, slice 1).
 * Holds a reference to the store (injected via init, same pattern as org/sec/live/family/library/career/lang).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 *
 * Execution providers:
 * - Local fallback (no keys): JavaScript only, via node:vm sandbox (2s timeout,
 *   no require/process/network) — same protocol as exam.js runCodeTests:
 *   the student's code may define `function solve(input)`; otherwise
 *   console.log output is the program output.
 * - Judge0 (env-optional): JUDGE0_API_URL (+ JUDGE0_API_KEY / JUDGE0_API_HOST
 *   for RapidAPI). When set, every supported language runs through Judge0.
 *   Injectable fetch (setFetch) so the Judge0 mapping is unit-testable.
 * - Kill switch (deploy readiness): CODE_EXEC_ENABLED=false disables all
 *   execution here (runCode returns a 503-style error, so challenge grading
 *   also reports per-case failures instead of running code). Default: enabled.
 */
const { randomUUID } = require('crypto');
const vm = require('node:vm');

let store = null;
function init(s) { store = s; }

let fetchImpl = null;
function setFetch(fn) { fetchImpl = fn; }
function doFetch(...args) { return (fetchImpl || fetch)(...args); }

const LANGUAGES = {
  javascript: { label: 'JavaScript', judge0Id: 63 },
  python: { label: 'Python', judge0Id: 71 },
  java: { label: 'Java', judge0Id: 62 },
  cpp: { label: 'C++', judge0Id: 54 },
  c: { label: 'C', judge0Id: 50 },
  go: { label: 'Go', judge0Id: 60 },
  ruby: { label: 'Ruby', judge0Id: 72 },
  rust: { label: 'Rust', judge0Id: 73 },
};
const LANGUAGE_IDS = Object.keys(LANGUAGES);
const CODE_TIMEOUT_MS = 2000;
const MAX_CODE_LEN = 65536;
const MAX_STDIN_LEN = 16384;
const JUDGE0_TIMEOUT_MS = 15000;
const GRADE_BUDGET_MS = 30000;

/** Code-runner kill switch: CODE_EXEC_ENABLED=false disables execution. */
function codeExecEnabled() {
  return String(process.env.CODE_EXEC_ENABLED || '').trim().toLowerCase() !== 'false';
}
const CODE_EXEC_DISABLED_MESSAGE = 'Code execution is disabled on this server.';

function str(v, max) {
  const s = String(v ?? '').trim();
  return s.length <= max ? s : null;
}

function isJudge0Configured() {
  return Boolean(String(process.env.JUDGE0_API_URL || '').trim());
}
function judge0Base() {
  return String(process.env.JUDGE0_API_URL || '').trim().replace(/\/+$/, '');
}
function judge0Headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.JUDGE0_API_KEY) h['X-RapidAPI-Key'] = process.env.JUDGE0_API_KEY;
  if (process.env.JUDGE0_API_HOST) h['X-RapidAPI-Host'] = process.env.JUDGE0_API_HOST;
  return h;
}

/**
 * Run JavaScript locally in a vm sandbox. stdin is passed to solve(input)
 * (or ignored when the code only logs). Returns {stdout, stderr, status, provider}.
 */
function runLocalJs(code, stdin) {
  const src = String(code || '').slice(0, MAX_CODE_LEN);
  const input = String(stdin || '').slice(0, MAX_STDIN_LEN);
  const logs = [];
  try {
    const sandbox = {
      __input: input,
      __logs: logs,
      __result: undefined,
      console: { log: (...a) => logs.push(a.map(x => String(x)).join(' ')) },
    };
    const wrapped = `${src}\n;__result = (typeof solve === 'function') ? solve(__input) : undefined;`;
    vm.createContext(sandbox);
    vm.runInContext(wrapped, sandbox, { timeout: CODE_TIMEOUT_MS, displayErrors: true });
    const out = sandbox.__result === undefined || sandbox.__result === null
      ? logs.join('\n')
      : String(sandbox.__result);
    return { stdout: out.slice(0, 8000), stderr: '', status: 'ok', provider: 'local' };
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/timed out/i.test(msg)) {
      return { stdout: logs.join('\n').slice(0, 8000), stderr: 'Time limit exceeded (2s).', status: 'timeout', provider: 'local' };
    }
    return { stdout: logs.join('\n').slice(0, 8000), stderr: msg.slice(0, 2000), status: 'error', provider: 'local' };
  }
}

/** Map a Judge0 submission to {stdout, stderr, status}; null while still processing. */
function mapJudge0Status(sub) {
  const st = (sub && sub.status) || {};
  const id = Number(st.id);
  const stdout = String(sub.stdout || '');
  if (id === 3) return { stdout, stderr: '', status: 'ok' };
  if (id === 6) return { stdout, stderr: String(sub.compile_output || 'Compilation error.'), status: 'error' };
  if (id === 5) return { stdout, stderr: 'Time limit exceeded.', status: 'timeout' };
  if (id === 1 || id === 2) return null;
  const stderr = String(sub.stderr || sub.compile_output || st.description || 'Runtime error.');
  return { stdout, stderr, status: 'error' };
}

async function runWithJudge0({ language, code, stdin }) {
  const lang = LANGUAGES[language];
  if (!lang) throw new Error('Unsupported language.');
  const base = judge0Base();
  const body = {
    source_code: String(code || '').slice(0, MAX_CODE_LEN),
    language_id: lang.judge0Id,
    stdin: String(stdin || '').slice(0, MAX_STDIN_LEN),
  };
  const deadline = Date.now() + JUDGE0_TIMEOUT_MS;
  let sub = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), JUDGE0_TIMEOUT_MS);
    const r = await doFetch(`${base}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST', headers: judge0Headers(), body: JSON.stringify(body), signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Judge0 request failed (${r.status}).`);
    sub = await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return { stdout: '', stderr: 'Judge0 timed out (15s).', status: 'timeout', provider: 'judge0' };
    throw e;
  }
  let mapped = mapJudge0Status(sub);
  const token = sub && sub.token;
  while (mapped === null && token && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await doFetch(`${base}/submissions/${encodeURIComponent(token)}?base64_encoded=false&fields=stdout,stderr,compile_output,status`, {
        headers: judge0Headers(), signal: ctl.signal,
      });
      clearTimeout(t);
      if (!r.ok) break;
      sub = await r.json();
      mapped = mapJudge0Status(sub);
    } catch { break; }
  }
  if (mapped === null) {
    return { stdout: String((sub && sub.stdout) || ''), stderr: 'Judge0 timed out (15s).', status: 'timeout', provider: 'judge0' };
  }
  return {
    stdout: mapped.stdout.slice(0, 8000),
    stderr: String(mapped.stderr || '').slice(0, 2000),
    status: mapped.status,
    provider: 'judge0',
  };
}

/**
 * Execute code. Returns {ok:true, stdout, stderr, status, provider} or
 * {ok:false, error, statusCode?}. Judge0 (when configured) handles every
 * supported language; otherwise only JavaScript runs locally and other
 * languages get a 501 with a clear message.
 */
async function runCode({ language, code, stdin }) {
  if (!codeExecEnabled()) return { ok: false, statusCode: 503, error: CODE_EXEC_DISABLED_MESSAGE };
  const lang = String(language || '').toLowerCase();
  if (!LANGUAGES[lang]) return { ok: false, error: 'Language must be one of: ' + LANGUAGE_IDS.join(', ') + '.' };
  if (typeof code !== 'string' || !code.length || code.length > MAX_CODE_LEN) {
    return { ok: false, error: 'Code must be 1 to 65536 characters.' };
  }
  if (stdin !== undefined && (typeof stdin !== 'string' || stdin.length > MAX_STDIN_LEN)) {
    return { ok: false, error: 'stdin must be 16384 characters or fewer.' };
  }
  if (isJudge0Configured()) {
    try {
      const out = await runWithJudge0({ language: lang, code, stdin });
      return { ok: true, ...out };
    } catch (e) {
      return { ok: false, error: 'Judge0 request failed: ' + String((e && e.message) || e).slice(0, 200) };
    }
  }
  if (lang !== 'javascript') {
    return { ok: false, statusCode: 501, error: `Set JUDGE0_API_URL to run ${LANGUAGES[lang].label}. JavaScript runs locally without configuration.` };
  }
  return { ok: true, ...runLocalJs(code, stdin) };
}

/**
 * Grade a challenge submission: run the code once per test case with the
 * case input as stdin, compare trimmed stdout to trimmed expected output.
 * A 30s overall budget guards against many slow cases; skipped cases are
 * reported as failed with an explanation instead of hanging the request.
 */
async function gradeChallenge(challenge, language, code) {
  const cases = ((challenge && challenge.testCases) || []).slice(0, 20);
  const results = [];
  let passed = 0;
  const deadline = Date.now() + GRADE_BUDGET_MS;
  for (const tc of cases) {
    if (Date.now() > deadline) {
      results.push({ input: tc.input, expected: tc.expectedOutput, actual: '', passed: false, error: 'Skipped: overall grading time limit (30s) reached.' });
      continue;
    }
    const r = await runCode({ language, code, stdin: tc.input });
    if (!r.ok) {
      results.push({ input: tc.input, expected: tc.expectedOutput, actual: '', passed: false, error: r.error || 'Execution failed.' });
      continue;
    }
    const actual = String(r.stdout || '').trim();
    const okPass = actual === String(tc.expectedOutput || '').trim();
    if (okPass) passed++;
    const entry = { input: tc.input, expected: tc.expectedOutput, actual: actual.slice(0, 2000), passed: okPass };
    if (r.status !== 'ok') entry.error = r.stderr || ('Execution ' + r.status + '.');
    results.push(entry);
  }
  return { results, passed, total: cases.length };
}

/** Validate a code project payload. Returns {ok, value} or {ok:false, error}. */
function validateProject(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const language = String(body.language !== undefined ? body.language : (existing && existing.language) || '').toLowerCase();
  if (!LANGUAGES[language]) return { ok: false, error: 'Language must be one of: ' + LANGUAGE_IDS.join(', ') + '.' };
  const code = body.code !== undefined ? body.code : (existing && existing.code);
  if (typeof code !== 'string' || code.length > MAX_CODE_LEN) return { ok: false, error: 'Code must be 65536 characters or fewer.' };
  return { ok: true, value: { title, language, code } };
}

/** Validate a test-case list: 1-20 cases, each with input + expectedOutput (<=2000 chars). */
function validateTestCases(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return { ok: false, error: 'Give 1 to 20 test cases.' };
  const out = [];
  for (const tc of raw) {
    const input = tc && tc.input !== undefined ? String(tc.input) : null;
    const expected = tc && (tc.expectedOutput !== undefined ? tc.expectedOutput : tc.expected) !== undefined
      ? String(tc.expectedOutput !== undefined ? tc.expectedOutput : tc.expected)
      : null;
    if (input === null || expected === null || input.length > 2000 || expected.length > 2000) {
      return { ok: false, error: 'Each test case needs input and expected output (2000 characters or fewer each).' };
    }
    out.push({ input, expectedOutput: expected });
  }
  return { ok: true, value: out };
}

/** Validate a coding challenge payload. Returns {ok, value} or {ok:false, error}. */
function validateChallenge(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const description = str(body.description !== undefined ? body.description : (existing && existing.description), 2000);
  if (!description || description.length < 4) return { ok: false, error: 'Description must be 4 to 2000 characters.' };
  const language = String(body.language !== undefined ? body.language : (existing && existing.language) || '').toLowerCase();
  if (!LANGUAGES[language]) return { ok: false, error: 'Language must be one of: ' + LANGUAGE_IDS.join(', ') + '.' };
  const starterCode = body.starterCode !== undefined ? body.starterCode : (existing && existing.starterCode);
  if (typeof starterCode !== 'string' || starterCode.length > MAX_CODE_LEN) return { ok: false, error: 'Starter code must be 65536 characters or fewer.' };
  let testCases = existing ? (existing.testCases || []) : [];
  if (body.testCases !== undefined || !existing) {
    const v = validateTestCases(body.testCases);
    if (!v.ok) return v;
    testCases = v.value;
  }
  return { ok: true, value: { title, description, language, starterCode, testCases } };
}

function publicProject(p) {
  return { id: p.id, studentId: p.studentId, title: p.title, language: p.language, code: p.code, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

/**
 * Student-facing challenge. Test cases are included (visible by design —
 * this lab's challenges are practice exercises, not hidden-answer exams).
 */
function publicChallenge(c, withTests) {
  const out = {
    id: c.id, institutionId: c.institutionId, title: c.title, description: c.description,
    language: c.language, starterCode: c.starterCode, testCaseCount: (c.testCases || []).length,
    createdBy: c.createdBy, createdAt: c.createdAt,
  };
  if (withTests) out.testCases = (c.testCases || []).map(t => ({ input: t.input, expectedOutput: t.expectedOutput }));
  return out;
}

module.exports = {
  init, setFetch, LANGUAGES, LANGUAGE_IDS, CODE_TIMEOUT_MS, MAX_CODE_LEN, MAX_STDIN_LEN,
  JUDGE0_TIMEOUT_MS, isJudge0Configured, runLocalJs, mapJudge0Status, runWithJudge0,
  runCode, gradeChallenge, validateProject, validateTestCases, validateChallenge,
  publicProject, publicChallenge, codeExecEnabled, CODE_EXEC_DISABLED_MESSAGE,
};
