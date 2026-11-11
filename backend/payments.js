'use strict';
/* Payments abstraction: test-mode by default; Razorpay or Stripe when env is set.
 * Env: RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET, or STRIPE_SECRET_KEY (+ STRIPE_WEBHOOK_SECRET).
 * Without keys, createOrder() returns a test-mode order and verifyWebhook() accepts
 * the local test signature. Never hard-requires a key. */

const crypto = require('node:crypto');

function provider() {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) return 'razorpay';
  if (process.env.STRIPE_SECRET_KEY) return 'stripe';
  return 'test';
}

/* amount: minor units (paise/cents). currency: ISO code, default INR. */
async function createOrder({ amount, currency, receipt, notes }) {
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Order amount must be positive.');
  const cur = String(currency || 'INR').toUpperCase().slice(0, 3);
  const p = provider();

  if (p === 'razorpay') {
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, currency: cur, receipt: String(receipt || `rcpt_${Date.now()}`).slice(0, 40), notes: notes || {} }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Razorpay order failed (${res.status}): ${data.error?.description || 'unknown'}.`);
    return { provider: 'razorpay', orderId: data.id, amount: data.amount, currency: data.currency, keyId: process.env.RAZORPAY_KEY_ID };
  }
  if (p === 'stripe') {
    const params = new URLSearchParams({ amount: String(amt), currency: cur.toLowerCase(), 'automatic_payment_methods[enabled]': 'true' });
    if (receipt) params.set('description', String(receipt).slice(0, 200));
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe PaymentIntent failed (${res.status}): ${data.error?.message || 'unknown'}.`);
    return { provider: 'stripe', orderId: data.id, clientSecret: data.client_secret, amount: data.amount, currency: data.currency };
  }
  return { provider: 'test', orderId: `test_${crypto.randomBytes(8).toString('hex')}`, amount: amt, currency: cur, note: 'Test mode — no real charge.' };
}

/* Verify an incoming webhook. Returns {verified:true, event} or {verified:false}. */
function verifyWebhook({ provider: prov, rawBody, signature, headers }) {
  const p = prov || provider();
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));

  if (p === 'razorpay') {
    // Razorpay sends x-razorpay-signature = HMAC_SHA256(rawBody, key_secret)
    const sig = String(signature || headers?.['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(raw).digest('hex');
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    return { verified: ok, provider: 'razorpay', event: ok ? safeJson(raw) : null };
  }
  if (p === 'stripe') {
    // Stripe: t=...,v1=... HMAC_SHA256("t.payload", webhook_secret)
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const header = String(signature || headers?.['stripe-signature'] || '');
    const t = /t=(\d+)/.exec(header)?.[1];
    const v1 = /v1=([a-f0-9]+)/.exec(header)?.[1];
    if (!t || !v1 || !secret) return { verified: false, provider: 'stripe', event: null };
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return { verified: false, provider: 'stripe', event: null, reason: 'stale timestamp' };
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    const ok = v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    return { verified: ok, provider: 'stripe', event: ok ? safeJson(raw) : null };
  }
  // Test mode: accept a locally-issued signature so the existing webhook stub keeps working.
  const sig = String(signature || '');
  const expected = crypto.createHmac('sha256', 'eduverse-test-webhook').update(raw).digest('hex');
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return { verified: ok, provider: 'test', event: ok ? safeJson(raw) : null };
}

function safeJson(buf) { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } }

module.exports = { provider, createOrder, verifyWebhook };
