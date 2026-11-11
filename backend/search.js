'use strict';
/* Full-text search: in-memory inverted index over courses, lessons, quizzes.
 * Built at startup and rebuilt (debounced 5s) on course/lesson/quiz writes.
 * Results are org-scoped by the caller via institutionId filter. */

let index = new Map(); // token -> Set of "kind:id"
let docs = new Map();  // "kind:id" -> {kind,id,title,snippet,institutionId}
let storeRef = null;
let rebuildTimer = null;

function init(store) { storeRef = store; }

function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 30);
}

function addDoc(kind, id, title, body, institutionId) {
  const key = `${kind}:${id}`;
  docs.set(key, { kind, id, title: String(title || '').slice(0, 120), snippet: String(body || '').slice(0, 200), institutionId: institutionId || null });
  for (const t of new Set(tokens(`${title} ${body}`))) {
    if (!index.has(t)) index.set(t, new Set());
    index.get(t).add(key);
  }
}

function rebuild() {
  index = new Map(); docs = new Map();
  if (!storeRef) return;
  for (const c of (storeRef.courses || [])) {
    if (c.status === 'archived') continue;
    addDoc('course', c.id, c.title, c.description, c.institutionId);
    // Lessons are nested in course.modules[].lessons[]
    for (const m of (c.modules || [])) {
      for (const l of (m.lessons || [])) {
        addDoc('lesson', l.id, l.title, `${l.content || ''} ${l.transcript || ''}`, c.institutionId);
      }
    }
  }
  // Also support a flat lessons collection if present
  for (const l of (storeRef.lessons || [])) {
    const course = (storeRef.courses || []).find(c => c.id === l.courseId);
    addDoc('lesson', l.id, l.title, `${l.content || ''} ${l.transcript || ''}`, course ? course.institutionId : (l.institutionId || null));
  }
  for (const q of (storeRef.quizzes || [])) {
    const course = (storeRef.courses || []).find(c => c.id === q.courseId);
    addDoc('quiz', q.id, q.title, q.description, course ? course.institutionId : (q.institutionId || null));
  }
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 5000);
  if (rebuildTimer.unref) rebuildTimer.unref();
}

/* q: string; institutionId: null = no filter (super admin). Returns max 20. */
function search(q, institutionId) {
  const query = String(q || '').trim().slice(0, 100);
  if (query.length < 2) return { error: 'Search needs at least 2 characters.', results: [] };
  const ts = tokens(query);
  if (!ts.length) return { results: [] };
  const scores = new Map();
  for (const t of ts) {
    for (const key of (index.get(t) || [])) scores.set(key, (scores.get(key) || 0) + 1);
  }
  const out = [];
  for (const [key, score] of scores) {
    const d = docs.get(key);
    if (!d) continue;
    if (institutionId && d.institutionId && d.institutionId !== institutionId) continue;
    out.push({ ...d, score });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { results: out.slice(0, 20).map(({ score, ...r }) => r) };
}

function stats() { return { tokens: index.size, docs: docs.size }; }

module.exports = { init, rebuild, scheduleRebuild, search, stats };
