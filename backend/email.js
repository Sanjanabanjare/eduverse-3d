'use strict';
/* Email provider: dev outbox by default; Resend or SendGrid when env is set.
 * Env: EMAIL_PROVIDER=resend|sendgrid, RESEND_API_KEY, SENDGRID_API_KEY,
 *      EMAIL_FROM (default noreply@eduverse.local).
 * Without keys, sendEmail() logs + stores in store.emailOutbox (dev behavior). */

let storeRef = null;
function init(store) { storeRef = store; }

function provider() {
  const p = String(process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (p === 'resend' && process.env.RESEND_API_KEY) return 'resend';
  if (p === 'sendgrid' && process.env.SENDGRID_API_KEY) return 'sendgrid';
  return 'outbox';
}

function outboxPush(record) {
  if (!storeRef) return;
  storeRef.emailOutbox ||= [];
  storeRef.emailOutbox.push(record);
  if (storeRef.emailOutbox.length > 200) storeRef.emailOutbox.splice(0, storeRef.emailOutbox.length - 200);
}

async function sendEmail({ to, subject, html, text }) {
  const dest = String(to || '').trim();
  if (!dest || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) throw new Error('Valid recipient email required.');
  const subj = String(subject || '').slice(0, 200);
  const bodyHtml = String(html || '').slice(0, 100000);
  const from = process.env.EMAIL_FROM || 'noreply@eduverse.local';
  const p = provider();

  if (p === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: dest, subject: subj, html: bodyHtml, text: text || undefined }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}).`);
    return { provider: 'resend', id: (await res.json().catch(() => ({}))).id || null };
  }
  if (p === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: dest }] }],
        from: { email: from },
        subject: subj,
        content: [{ type: 'text/html', value: bodyHtml }],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid failed (${res.status}).`);
    return { provider: 'sendgrid', id: null };
  }
  // Dev outbox fallback
  const record = { id: require('node:crypto').randomUUID(), to: dest, subject: subj, html: bodyHtml.slice(0, 20000), at: new Date().toISOString(), provider: 'outbox' };
  outboxPush(record);
  return { provider: 'outbox', id: record.id };
}

module.exports = { init, provider, sendEmail };
