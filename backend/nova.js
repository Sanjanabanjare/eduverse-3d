'use strict';
/**
 * backend/nova.js — Nova AI provider.
 *
 * Uses OpenAI (chat completions) when OPENAI_API_KEY is set, otherwise runs
 * local built-in implementations over the user's real data. The key is read
 * ONLY from the environment at call time and is never written to disk, logs,
 * or the JSON store. Model override via NOVA_MODEL (default gpt-4o-mini).
 */
const OPENAI_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';

function provider() {
  return process.env.OPENAI_API_KEY ? 'openai' : 'local';
}

/** System prompt for the ChatGPT-style chat (history-aware). */
const CHAT_SYS = 'You are Nova, the EduVerse AI study companion. Be concise, warm, and concrete. Use short steps and examples. Never invent grades, records, or personal data. If asked about something outside learning or EduVerse, answer briefly and steer back to learning. Markdown is fine.';

/**
 * Full-history chat completion.
 * messages: [{role:'system'|'user'|'assistant', content}].
 * With onToken, streams (SSE) and calls onToken(delta) per chunk, returning the
 * assembled text. Without onToken, behaves like chatComplete (one JSON call).
 * Errors: 'no-key', 'openai-http-<status>', 'openai-empty'. Never logs the key.
 */
async function chatCompleteMessages(messages, { maxTokens = 800, onToken } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no-key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env.NOVA_MODEL || 'gpt-4o-mini',
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(onToken ? { stream: true } : {}),
      }),
    });
    if (!r.ok) throw new Error('openai-http-' + r.status);
    if (!onToken) {
      const d = await r.json();
      const text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (!text) throw new Error('openai-empty');
      return text.trim();
    }
    // SSE stream: `data: {...}` lines, `data: [DONE]` ends it.
    let full = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { finished = true; break; }
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (delta) { full += delta; onToken(delta); }
      }
    }
    if (!full.trim()) throw new Error('openai-empty');
    return full.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function chatComplete(system, user, maxTokens = 800) {
  return chatCompleteMessages([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { maxTokens });
}

/* ---------------- local text helpers (no network) ---------------- */
function sentencesOf(text) {
  return String(text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [];
}
function keywords(text, n = 12) {
  const stop = new Set(('a,an,the,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,his,her,its,our,their,this,that,these,those,as,of').split(','));
  const freq = {};
  String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .forEach(w => { if (w.length > 3 && !stop.has(w)) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}
function extractiveSummary(text, maxSentences = 6) {
  const sents = sentencesOf(text);
  if (!sents.length) return 'Not enough text to summarize yet.';
  const kw = new Set(keywords(text, 15));
  const scored = sents.map((s, i) => {
    const words = s.toLowerCase().split(/\s+/);
    const hits = words.filter(w => kw.has(w.replace(/[^a-z]/g, ''))).length;
    return { s: s.trim(), score: hits / Math.max(1, words.length) + (i < 3 ? 0.05 : 0), i };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences)
    .sort((a, b) => a.i - b.i).map(x => '• ' + x.s).join('\n');
}
function localNotes(topic, text) {
  const sents = sentencesOf(text);
  const kw = keywords(text, 10);
  const head = `# ${topic}\n\n## Key ideas\n` +
    (sents.slice(0, 5).map(s => `- ${s.trim()}`).join('\n') || '- (add lesson text to generate notes)');
  return head + `\n\n## Terms to remember\n` +
    (kw.slice(0, 8).map(k => `- **${k}** — appears ${String(text).toLowerCase().split(k).length - 1}× in this lesson`).join('\n')) +
    `\n\n## Quick recap\n${extractiveSummary(text, 3)}`;
}
function localFlashcards(questions) {
  return (questions || []).slice(0, 12).map(q => {
    if (q.type === 'mcq' || q.type === 'multiselect') {
      const ans = (q.type === 'mcq' ? [q.options[q.correctIndex]]
        : (q.correctIndices || []).map(i => q.options[i])).filter(Boolean).join('; ');
      return { front: q.prompt, back: ans || '(see solutions)' };
    }
    if (q.type === 'truefalse') return { front: q.prompt, back: q.correctBoolean ? 'True' : 'False' };
    if (q.type === 'fillblank') return { front: q.template.replace(/___/g, '___?___'), back: (q.blankAnswers || []).map(b => b[0]).join(' / ') };
    if (q.type === 'match') return { front: 'Match: ' + q.pairs.map(p => p.left).join(', '), back: q.pairs.map(p => `${p.left} → ${p.right}`).join('; ') };
    return { front: q.prompt, back: '(practice answer)' };
  });
}

/* ---------------- tool implementations ----------------
   Each tool: async (ctx, input) => { result, provider }.
   ctx: { user, store helpers } provided by server.js wiring.
   ai(): tries OpenAI, falls back to the local implementation on ANY failure
   (no key, no credits, network error) so tools always work. */
async function ai(system, user, maxTokens, localFn) {
  if (process.env.OPENAI_API_KEY) {
    try { return { result: await chatComplete(system, user, maxTokens), provider: 'openai' }; }
    catch { /* fall through to local */ }
  }
  return { result: await localFn(), provider: 'local' };
}
const SYS = 'You are Nova, the EduVerse AI study companion. Be concise, warm, and concrete. Use short steps and examples. Never invent grades or records.';

const tools = {
  tutor: {
    desc: 'Explain any topic step by step',
    async run(ctx, input) {
      const topic = String(input.topic || input.q || '').slice(0, 500);
      if (!topic) throw new Error('Give a topic to explain.');
      return ai(SYS, `Explain this topic step by step for a student, with a tiny example and a 1-line check question: ${topic}`, 800,
        () => `**${topic} — step by step**\n\n1. **Start with the idea in one line.** ${topic} is best learned by seeing what problem it solves — ask yourself "when would I use this?"\n2. **Break it into parts.** List the 2–3 moving pieces and learn each alone before combining them.\n3. **Work one tiny example by hand.** Small numbers, small input — trace every step.\n4. **Check yourself.** Can you explain it to a friend in 30 seconds? If not, revisit step 2.\n\nTry a lesson or quiz on this topic next, then come back with what felt shaky.`);
    },
  },
  doubt: {
    desc: 'Answer student questions',
    async run(ctx, input) {
      const q = String(input.q || '').slice(0, 1000);
      if (!q) throw new Error('Ask a question.');
      const lessonCtx = (input.lessonText || '').slice(0, 4000);
      const kw = keywords(q, 6);
      const hit = lessonCtx && kw.some(k => lessonCtx.toLowerCase().includes(k));
      return ai(SYS, `Answer this student doubt clearly and briefly. Use this lesson context if relevant:\n---\n${lessonCtx}\n---\nDoubt: ${q}`, 800,
        () => `Good question. ${hit ? 'Your lesson actually touches on this — re-read the part mentioning **' + kw.find(k => lessonCtx.toLowerCase().includes(k)) + '**.' : 'Here is how to attack it:'}\n\n1. Restate the doubt in your own words — half of doubts dissolve here.\n2. Find the one definition or formula it hinges on and write it down.\n3. Test it on the smallest possible example.\n\nIf it still resists, ask your teacher with the exact step where you got stuck — that detail gets you a useful answer fast.`);
    },
  },
  notes: {
    desc: 'Convert lessons into organized notes',
    async run(ctx, input) {
      const topic = String(input.topic || 'Lesson notes').slice(0, 200);
      const text = String(input.text || '').slice(0, 20000);
      if (!text.trim()) throw new Error('Provide lesson text to convert.');
      return ai(SYS + ' Format as markdown with headings.', `Turn these lesson materials into organized study notes (headings, key ideas, terms, quick recap):\n\n${text.slice(0, 12000)}`, 1200,
        () => localNotes(topic, text));
    },
  },
  quizgen: {
    desc: 'Generate quizzes from study material',
    async run(ctx, input) {
      const text = String(input.text || '').slice(0, 12000);
      const count = Math.max(1, Math.min(10, Number(input.count) || 5));
      if (!text.trim()) throw new Error('Provide study material.');
      const local = () => {
        const sents = sentencesOf(text).filter(s => s.trim().length > 40);
        const kw = keywords(text, 20);
        const questions = [];
        for (let i = 0; i < Math.min(count, sents.length); i++) {
          const sent = sents[Math.floor(i * sents.length / Math.min(count, sents.length))].trim();
          const key = kw[i % kw.length] || 'concept';
          const distract = kw.filter(k => k !== key).slice(0, 3);
          while (distract.length < 3) distract.push('none of these');
          const options = [key, ...distract.slice(0, 3)];
          questions.push({ prompt: `Which term best fits: "${sent.slice(0, 120)}…"?`, options, correctIndex: 0, explanation: `The sentence centers on "${key}".` });
        }
        return { questions };
      };
      if (process.env.OPENAI_API_KEY) {
        try {
          const raw = await chatComplete(SYS, `Create ${count} multiple-choice questions from this material. Reply as JSON array: [{"prompt","options":[4],"correctIndex","explanation"}].\n\n${text.slice(0, 10000)}`, 1500);
          const arr = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
          if (Array.isArray(arr) && arr.length) return { result: { questions: arr.slice(0, count) }, provider: 'openai' };
        } catch { /* local */ }
      }
      return { result: local(), provider: 'local' };
    },
  },
  flashcards: {
    desc: 'Create revision flashcards',
    async run(ctx, input) {
      const fromQuiz = input.quizId ? (ctx.store.quizzes || []).find(q => q.id === input.quizId) : null;
      const local = () => ({
        cards: fromQuiz ? localFlashcards(fromQuiz.questions)
          : sentencesOf(String(input.text || '')).slice(0, 12).map(s => ({ front: s.trim().slice(0, 140), back: '(recall the detail)' })),
      });
      if (process.env.OPENAI_API_KEY && input.text) {
        try {
          const raw = await chatComplete(SYS, `Create up to 12 flashcards from this material. Reply as JSON array [{"front","back"}]:\n\n${String(input.text).slice(0, 10000)}`, 1200);
          const arr = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
          if (Array.isArray(arr) && arr.length) return { result: { cards: arr.slice(0, 12) }, provider: 'openai' };
        } catch { /* local */ }
      }
      return { result: local(), provider: 'local' };
    },
  },
  summarizer: {
    desc: 'Summarize lengthy PDFs and lessons',
    async run(ctx, input) {
      const text = String(input.text || '').slice(0, 30000);
      if (!text.trim()) throw new Error('Provide text to summarize.');
      return ai(SYS, `Summarize this in 5-8 crisp bullet points, then one "in one line" takeaway:\n\n${text.slice(0, 15000)}`, 900,
        () => extractiveSummary(text, 7) + '\n\n**In one line:** ' + (sentencesOf(text)[0] || '').trim());
    },
  },
  planner: {
    desc: 'Create personalized study schedules',
    async run(ctx, input) {
      const days = Math.max(1, Math.min(30, Number(input.days) || 7));
      const enrollments = (ctx.store.enrollments || []).filter(e => e.studentId === ctx.user.id);
      const courses = enrollments.map(e => (ctx.store.courses || []).find(c => c.id === e.courseId)).filter(Boolean);
      const plan = [];
      for (let d = 1; d <= days; d++) {
        const course = courses[(d - 1) % Math.max(1, courses.length)];
        plan.push({ day: d, focus: course ? course.title : 'Revision', task: d % 3 === 0 ? 'Quiz + flashcards' : d % 3 === 1 ? 'Video lessons (2)' : 'Reading + notes' });
      }
      return ai(SYS, `Make a ${days}-day study plan for these courses: ${courses.map(c => c.title).join(', ') || 'general revision'}. Keep it to day: focus — task lines.`, 700,
        () => ({ plan }));
    },
  },
  assignment: {
    desc: 'Guide students through assignments',
    async run(ctx, input) {
      const a = (ctx.store.assignments || []).find(x => x.id === input.assignmentId);
      if (!a) throw new Error('Assignment not found.');
      const qs = (a.questions || []).slice(0, 6).map((q, i) => `${i + 1}. ${q}`).join('\n');
      return ai(SYS + ' Guide with hints and steps, never write the full answer.', `Help the student plan this assignment (hints and steps only):\n${a.title}\n${qs}`, 800,
        () => `**Plan for "${a.title}"**\n\n${(a.questions || []).map((q, i) => `${i + 1}. **${String(q).slice(0, 80)}**\n   → First: restate what is asked. Then: list what you know. Finally: solve one small case before the general one.`).join('\n\n') || 'Break the task into its smallest steps and tackle them in order.'}\n\nWork each step, then compare with a friend before submitting.`);
    },
  },
  codementor: {
    desc: 'Explain, debug and review code',
    async run(ctx, input) {
      const code = String(input.code || '').slice(0, 6000);
      const lang = String(input.language || 'javascript').slice(0, 20);
      if (!code.trim()) throw new Error('Paste code to review.');
      return ai(SYS, `Review this ${lang} code: explain what it does, flag bugs, suggest one improvement. Be brief.\n\n${code.slice(0, 5000)}`, 900,
        () => {
          const notes = [];
          if (/console\.log/.test(code)) notes.push('Remove debug `console.log` calls before submitting.');
          if (code.split('\n').some(l => l.length > 120)) notes.push('Some lines are very long — break them for readability.');
          if (!/function|=>|def |class /.test(code)) notes.push('No functions found — splitting logic into functions helps testing.');
          const opens = (code.match(/{/g) || []).length, closes = (code.match(/}/g) || []).length;
          if (opens !== closes) notes.push(`Brace mismatch: ${opens} "{" vs ${closes} "}" — likely a syntax error.`);
          return `**Quick review (${lang})**\n\n${notes.length ? notes.map(n => `- ${n}`).join('\n') : '- Structure looks reasonable at a glance.'}\n\n**How to debug:** run it on the smallest input, print intermediate values, and check one function at a time. For a deeper review, connect an AI key or ask your teacher.`;
        });
    },
  },
  writing: {
    desc: 'Improve grammar and academic writing',
    async run(ctx, input) {
      const text = String(input.text || '').slice(0, 8000);
      if (!text.trim()) throw new Error('Provide text to improve.');
      return ai(SYS, `Improve this student writing: fix grammar, tighten sentences, keep their meaning and voice. Show the improved version, then 3 brief tips.\n\n${text.slice(0, 6000)}`, 1000,
        () => {
          const tips = [];
          const sents = sentencesOf(text);
          const long = sents.filter(s => s.split(/\s+/).length > 28);
          if (long.length) tips.push(`Break up ${long.length} long sentence(s) — aim under 25 words.`);
          const dupes = text.toLowerCase().match(/\b(\w+)\s+\1\b/g);
          if (dupes) tips.push(`Repeated words spotted: ${[...new Set(dupes)].slice(0, 3).join(', ')}.`);
          if (/\b(very|really|just|quite)\b/i.test(text)) tips.push('Cut filler words like "very/really/just" — stronger verbs carry the sentence.');
          return `**Writing check**\n\n- Sentences: ${sents.length}, words: ${text.split(/\s+/).length}\n${tips.length ? tips.map(t => `- ${t}`).join('\n') : '- No obvious issues found.'}\n\nRead it aloud once — anywhere you stumble, your reader will too.`;
        });
    },
  },
  research: {
    desc: 'Help organize research and references',
    async run(ctx, input) {
      const items = Array.isArray(input.items) ? input.items.slice(0, 20) : String(input.text || '').split('\n').filter(Boolean).slice(0, 20);
      if (!items.length) throw new Error('Provide references or notes to organize.');
      return ai(SYS, `Organize these research notes/references into themes with 1-line summaries each:\n\n${items.join('\n').slice(0, 6000)}`, 900,
        () => {
          const groups = {};
          items.forEach(it => { const k = keywords(it, 1)[0] || 'general'; (groups[k] = groups[k] || []).push(it); });
          return `**Organized by theme**\n\n` + Object.entries(groups).map(([k, v]) => `### ${k}\n${v.map(x => `- ${String(x).slice(0, 160)}`).join('\n')}`).join('\n\n');
        });
    },
  },
  recommend: {
    desc: 'Recommend what to study next',
    async run(ctx, input) {
      const uid = ctx.user.id;
      const attempts = (ctx.store.quizAttempts || []).filter(a => a.studentId === uid);
      const weak = {};
      attempts.forEach(a => {
        const quiz = (ctx.store.quizzes || []).find(q => q.id === a.quizId);
        (a.questionResults || []).forEach(qr => {
          const q = quiz && (quiz.questions || []).find(x => x.id === qr.questionId);
          const topic = (q && q.topic) || (quiz && quiz.title) || 'general';
          weak[topic] = weak[topic] || { total: 0, wrong: 0 };
          weak[topic].total++;
          if (!qr.correct) weak[topic].wrong++;
        });
      });
      const ranked = Object.entries(weak).map(([t, v]) => ({ topic: t, rate: v.wrong / v.total, n: v.total }))
        .filter(x => x.n >= 2).sort((a, b) => b.rate - a.rate).slice(0, 3);
      const enrollments = (ctx.store.enrollments || []).filter(e => e.studentId === uid);
      const nextLesson = [];
      for (const e of enrollments.slice(0, 3)) {
        const course = (ctx.store.courses || []).find(c => c.id === e.courseId);
        if (!course) continue;
        const done = new Set(ctx.store.courseLessonProgress[`${uid}:${e.courseId}`] || []);
        const lessons = (course.modules || []).flatMap(m => m.lessons || []);
        const nxt = lessons.find(l => !done.has(l.id));
        if (nxt) nextLesson.push({ course: course.title, lesson: nxt.title });
      }
      const rec = { weakTopics: ranked, continueLessons: nextLesson };
      if (!ranked.length && !nextLesson.length)
        return { result: { ...rec, summary: 'Enroll in a course and take a quiz to unlock recommendations.' }, provider: 'local' };
      return ai(SYS, `Based on this learning data, recommend what to study next in 3 short bullets:\n${JSON.stringify(rec).slice(0, 2000)}`, 400,
        () => rec);
    },
  },
  teacher: {
    desc: 'Help teachers create learning material',
    async run(ctx, input) {
      const topic = String(input.topic || '').slice(0, 300);
      const kind = String(input.kind || 'lesson-outline').slice(0, 40);
      if (!topic) throw new Error('Give a topic.');
      return ai(SYS, `Create a ${kind} for teaching "${topic}": clear structure a teacher can use directly.`, 1000,
        () => `**${kind} — ${topic}**\n\n1. **Hook (2 min):** one surprising fact or question about ${topic}.\n2. **Core ideas:** 3 key points, each with a tiny example.\n3. **Activity:** students try one small task in pairs.\n4. **Check:** 3 quiz questions (easy → hard).\n5. **Takeaway:** one line to remember.\n\nFill each block from your expertise — this skeleton keeps the lesson tight.`);
    },
  },
  performance: {
    desc: 'Identify weak topics and suggest improvements',
    async run(ctx, input) {
      const targetId = ctx.user.role === 'teacher' && input.studentId ? input.studentId : ctx.user.id;
      const attempts = (ctx.store.quizAttempts || []).filter(a => a.studentId === targetId);
      if (!attempts.length) return { result: { summary: 'No quiz attempts yet — take a quiz to unlock your performance analysis.', topics: [] }, provider: 'local' };
      const byTopic = {};
      let totalScore = 0, totalMax = 0;
      attempts.forEach(a => {
        totalScore += Number(a.finalScore || 0); totalMax += 100;
        const quiz = (ctx.store.quizzes || []).find(q => q.id === a.quizId);
        (a.questionResults || []).forEach(qr => {
          const q = quiz && (quiz.questions || []).find(x => x.id === qr.questionId);
          const topic = (q && q.topic) || (quiz && quiz.title) || 'general';
          byTopic[topic] = byTopic[topic] || { n: 0, earned: 0, max: 0 };
          byTopic[topic].n++;
          byTopic[topic].earned += Number(qr.points || 0);
          byTopic[topic].max += Number(qr.maxPoints || q?.points || 1);
        });
      });
      const topics = Object.entries(byTopic).map(([t, v]) => ({
        topic: t, accuracy: v.max ? Math.round(v.earned / v.max * 100) : 0, attempts: v.n,
        suggestion: v.max && v.earned / v.max < 0.6 ? 'Revisit lessons on this, then retry with flashcards.' : 'Solid — maintain with spaced revision.',
      })).sort((a, b) => a.accuracy - b.accuracy);
      return { result: { summary: `Overall quiz average ${Math.round(totalScore / Math.max(1, attempts.length))}% across ${attempts.length} attempt(s).`, topics }, provider: 'local' };
    },
  },
};

module.exports = { tools, provider, chatComplete, chatCompleteMessages, CHAT_SYS };
