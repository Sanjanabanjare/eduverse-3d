/* Quiz Generator helpers (slice 1, advanced-features round).
 *
 * - Text extraction from uploaded notes: plain text / Markdown as-is; PDF via a
 *   minimal content-stream parser (FlateDecode decompression + literal/hex string
 *   extraction). This reads the PDF text layer only — scanned/image PDFs have no
 *   text layer and will yield little or nothing. Honest limits, no new deps.
 * - Normalization of generated questions into the quiz engine's MCQ shape.
 */
const zlib = require('node:zlib');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;

/* Decode a PDF literal string: handle \( \) \\ \n \r \t \b \f and octal \ddd. */
function unescapePdfString(s) {
  return s.replace(/\\([nrtbf()\\]|\\|[0-7]{1,3})/g, (m, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    if (c === 'b') return '\b';
    if (c === 'f') return '\f';
    if (/^[0-7]{1,3}$/.test(c)) return String.fromCharCode(parseInt(c, 8) & 0xff);
    return c;
  });
}

function extractStringsFromContent(text) {
  const parts = [];
  // Literal strings: ( ... ) with nested parens / escapes.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(') continue;
    let depth = 0, cur = '', j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === '\\' && j + 1 < text.length) { cur += text[j] + text[j + 1]; j++; continue; }
      if (ch === '(') { depth++; if (depth > 1) cur += ch; continue; }
      if (ch === ')') { depth--; if (depth === 0) break; cur += ch; continue; }
      cur += ch;
    }
    if (depth === 0) {
      const decoded = unescapePdfString(cur).replace(/\s+/g, ' ').trim();
      if (decoded.length >= 2) parts.push(decoded);
      i = j;
    }
  }
  // Hex strings: <48656c6c6f> — only when they decode to mostly printable text.
  const hexRe = /<([0-9a-fA-F\s]{4,})>/g;
  let m;
  while ((m = hexRe.exec(text)) !== null) {
    const hex = m[1].replace(/\s+/g, '');
    if (hex.length % 2 !== 0) continue;
    try {
      const buf = Buffer.from(hex, 'hex');
      const s = buf.toString('utf8').replace(/\s+/g, ' ').trim();
      const printable = [...s].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 || c.charCodeAt(0) > 127).length;
      if (s.length >= 2 && printable / s.length > 0.8) parts.push(s);
    } catch { /* ignore bad hex */ }
  }
  return parts.join(' ');
}

function tryDecompress(buf) {
  // zlib-wrapped deflate first, then raw deflate.
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(buf).toString('latin1'); } catch { /* try next */ }
  }
  return null;
}

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [];
  // Content streams: stream ... endstream
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const bytes = Buffer.from(m[1], 'latin1');
    const decompressed = tryDecompress(bytes);
    chunks.push(decompressed !== null ? decompressed : m[1]);
  }
  const haystack = chunks.length ? chunks.join('\n') : raw;
  const text = extractStringsFromContent(haystack);
  return text.replace(/\s+/g, ' ').trim();
}

function extractText(buffer, mimeType, filename) {
  const name = String(filename || '').toLowerCase();
  const mt = String(mimeType || '').toLowerCase();
  const isPdf = mt === 'application/pdf' || name.endsWith('.pdf');
  const isText = mt === 'text/plain' || mt === 'text/markdown' || mt === 'text/x-markdown'
    || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown');
  if (isPdf) {
    const text = extractPdfText(buffer);
    return { ok: true, text, kind: 'pdf' };
  }
  if (isText) {
    return { ok: true, text: buffer.toString('utf8'), kind: 'text' };
  }
  return { ok: false, error: 'Only TXT, Markdown, and PDF notes are supported.' };
}

/* Normalize one generated question into the quiz engine's MCQ shape.
 * Returns null when the question is unusable. */
function normalizeGeneratedQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  const prompt = String(q.prompt || '').trim();
  if (prompt.length < 2 || prompt.length > 2000) return null;
  const options = (Array.isArray(q.options) ? q.options : []).map(o => String(o).trim()).filter(Boolean);
  if (options.length < 2 || options.length > 10) return null;
  const correctIndex = Math.floor(Number(q.correctIndex));
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;
  return {
    type: 'mcq',
    prompt,
    options,
    correctIndex,
    explanation: String(q.explanation || '').slice(0, 2000),
  };
}

function normalizeGeneratedQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map(normalizeGeneratedQuestion).filter(Boolean);
}

/* Frontend-friendly shape for the generate response (no internal type field). */
function publicGeneratedQuestion(q) {
  return { prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation || '' };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_TEXT_CHARS,
  extractText,
  extractPdfText,
  normalizeGeneratedQuestion,
  normalizeGeneratedQuestions,
  publicGeneratedQuestion,
};
