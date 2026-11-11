'use strict';
/* Notifications helper. Triggers: fee assigned, quiz graded, live class scheduled,
 * marketplace purchase. If email is configured and kind includes email intent,
 * also queues an email via backend/email.js. */

const crypto = require('node:crypto');
const email = require('./email');

let storeRef = null;
function init(store) { storeRef = store; email.init(store); }

/* notify(userId, {kind, title, body, link, email}) — email:true also sends email when configured. */
async function notify(userId, { kind, title, body, link, email: sendMail }) {
  if (!storeRef || !userId) return null;
  const n = {
    id: crypto.randomUUID(),
    userId,
    kind: String(kind || 'info').slice(0, 40),
    title: String(title || '').slice(0, 120),
    body: String(body || '').slice(0, 500),
    link: String(link || '').slice(0, 300),
    createdAt: new Date().toISOString(),
    read: false,
  };
  storeRef.notifications ||= [];
  storeRef.notifications.unshift(n);
  if (storeRef.notifications.length > 500) storeRef.notifications.length = 500;
  if (sendMail) {
    const user = (storeRef.users || []).find(u => u.id === userId);
    if (user && user.email) {
      try { await email.sendEmail({ to: user.email, subject: n.title, html: `<p>${escapeHtml(n.body)}</p>${n.link ? `<p><a href="${escapeHtml(n.link)}">${escapeHtml(n.link)}</a></p>` : ''}` }); }
      catch (e) { /* email failures never break notifications */ }
    }
  }
  return n;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Convenience triggers used by server.js */
async function feeAssigned(studentId, feeRecord) {
  return notify(studentId, {
    kind: 'fee_assigned', title: 'New fee assigned',
    body: `Amount due: ${feeRecord.amountDue}${feeRecord.dueDate ? ` by ${new Date(feeRecord.dueDate).toLocaleDateString()}` : ''}.`,
    link: '/fees', email: true,
  });
}
async function quizGraded(studentId, quizTitle, score) {
  return notify(studentId, {
    kind: 'quiz_graded', title: 'Quiz graded',
    body: `${quizTitle}: ${score}.`, link: '/quizzes',
  });
}
async function liveClassScheduled(userIds, sessionTitle, startsAt) {
  const when = new Date(startsAt).toLocaleString();
  for (const id of userIds) {
    await notify(id, { kind: 'live_class', title: 'Live class scheduled', body: `${sessionTitle} — ${when}.`, link: '/live' });
  }
}
async function marketplacePurchase(studentId, courseTitle) {
  return notify(studentId, {
    kind: 'marketplace', title: 'Course purchased',
    body: `You enrolled in "${courseTitle}" via the marketplace.`, link: '/courses', email: true,
  });
}

module.exports = { init, notify, feeAssigned, quizGraded, liveClassScheduled, marketplacePurchase };
