'use strict';
/**
 * backend/lang.js — language learning + UI language preference helpers (Slice 4).
 * Holds a reference to the store (injected via init, same pattern as org/sec/live/family/library/career).
 * No circular require: server.js requires this file; this file requires nothing
 * from server.js.
 */
const { randomUUID } = require('crypto');

let store = null;
function init(s) { store = s; }

const UI_LANGS = ['en', 'hi', 'ta', 'bn', 'mr'];

function str(v, max) {
  const s = String(v ?? '').trim();
  return s.length <= max ? s : null;
}

/** Validate a vocab set payload. Returns {ok, value} or {ok:false, error}. */
function validateVocabSet(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const language = str(body.language !== undefined ? body.language : (existing && existing.language), 40);
  if (!language || language.length < 2) return { ok: false, error: 'Language must be 2 to 40 characters.' };
  let words = existing ? (existing.words || []) : [];
  if (body.words !== undefined || !existing) {
    const raw = Array.isArray(body.words) ? body.words : [];
    if (raw.length < 1 || raw.length > 200) return { ok: false, error: 'Give 1 to 200 words.' };
    words = [];
    for (const w of raw) {
      const word = str(w && w.word, 80);
      const meaning = str(w && w.meaning, 200);
      const example = w && w.example !== undefined ? str(w.example, 300) : '';
      if (!word || !meaning) return { ok: false, error: 'Every word needs a word and a meaning.' };
      if (example === null) return { ok: false, error: 'Example must be 300 characters or fewer.' };
      words.push({ id: (w && w.id) || randomUUID(), word, meaning, example: example || '' });
    }
  }
  return { ok: true, value: { title, language, words } };
}

/** Validate a speaking exercise payload. */
function validateSpeakingExercise(body, existing) {
  const title = str(body.title !== undefined ? body.title : (existing && existing.title), 120);
  if (!title || title.length < 2) return { ok: false, error: 'Title must be 2 to 120 characters.' };
  const language = str(body.language !== undefined ? body.language : (existing && existing.language), 40);
  if (!language || language.length < 2) return { ok: false, error: 'Language must be 2 to 40 characters.' };
  const prompt = str(body.prompt !== undefined ? body.prompt : (existing && existing.prompt), 500);
  if (!prompt || prompt.length < 4) return { ok: false, error: 'Prompt must be 4 to 500 characters.' };
  const targetPhrase = str(body.targetPhrase !== undefined ? body.targetPhrase : (existing && existing.targetPhrase), 300);
  if (!targetPhrase || targetPhrase.length < 2) return { ok: false, error: 'Target phrase must be 2 to 300 characters.' };
  return { ok: true, value: { title, language, prompt, targetPhrase } };
}

/** Normalise free text for comparison: lowercase, strip punctuation, collapse whitespace. */
function normWords(text) {
  return String(text || '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean);
}

/** Grade a vocab attempt: answers keyed by word id, exact meaning match after normalization. */
function gradeVocab(set, answers) {
  const words = (set && set.words) || [];
  let correct = 0;
  for (const w of words) {
    const given = normWords(answers && answers[w.id]).join(' ');
    const want = normWords(w.meaning).join(' ');
    if (given && given === want) correct++;
  }
  const total = words.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { score, total, correct, passed: score >= 60 };
}

/**
 * Score a speaking attempt by word overlap: |transcript ∩ target| / |target|, 0-100.
 * Honest by design: the browser's speech recognition does the listening; this just
 * compares the transcript against the target phrase.
 */
function scoreSpeaking(targetPhrase, transcript) {
  const target = normWords(targetPhrase);
  if (!target.length) return { score: 0, matched: 0, total: 0 };
  const said = new Set(normWords(transcript));
  const matched = target.filter(w => said.has(w)).length;
  return { score: Math.round((matched / target.length) * 100), matched, total: target.length };
}

/** Student-facing vocab set list item (no word details, just counts). */
function publicVocabSet(s, withWords) {
  const out = { id: s.id, institutionId: s.institutionId, title: s.title, language: s.language, wordCount: (s.words || []).length, createdBy: s.createdBy, createdAt: s.createdAt };
  if (withWords) out.words = (s.words || []).map(w => ({ id: w.id, word: w.word, meaning: w.meaning, example: w.example }));
  return out;
}

/** Student-facing speaking exercise (target phrase included — it's the practice goal). */
function publicSpeakingExercise(e) {
  return { id: e.id, institutionId: e.institutionId, title: e.title, language: e.language, prompt: e.prompt, targetPhrase: e.targetPhrase, createdBy: e.createdBy, createdAt: e.createdAt };
}

function validateUiLang(v) {
  const lang = String(v || '').toLowerCase();
  return UI_LANGS.includes(lang) ? lang : null;
}

module.exports = {
  init, UI_LANGS, validateVocabSet, validateSpeakingExercise,
  gradeVocab, scoreSpeaking, publicVocabSet, publicSpeakingExercise, validateUiLang,
};
