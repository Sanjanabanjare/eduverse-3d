'use strict';

const { createHash } = require('node:crypto');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIdempotencyExecutor({ store, persist, ttlMs = DEFAULT_TTL_MS, now = Date.now }) {
  const inFlight = new Map();
  store.idempotencyResults ||= {};

  return async function execute({ actorId, scope, key, payload }, operation) {
    if (!key) {
      const result = await operation();
      if (result.changed) await persist();
      return result;
    }

    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      return { status: 400, payload: { error: 'Idempotency-Key must be 8 to 128 letters, numbers, dots, underscores, colons, or hyphens.' } };
    }

    const keyId = createHash('sha256').update(`${actorId}:${scope}:${key}`).digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
    const timestamp = now();

    for (const [id, record] of Object.entries(store.idempotencyResults)) {
      if (record.expiresAt <= timestamp) delete store.idempotencyResults[id];
    }

    const saved = store.idempotencyResults[keyId];
    if (saved) {
      if (saved.fingerprint !== fingerprint) {
        return { status: 409, payload: { error: 'This Idempotency-Key was already used with a different request.' } };
      }
      return clone(saved.result);
    }

    const pending = inFlight.get(keyId);
    if (pending) {
      if (pending.fingerprint !== fingerprint) {
        return { status: 409, payload: { error: 'This Idempotency-Key is already processing a different request.' } };
      }
      return clone(await pending.promise);
    }

    const promise = (async () => {
      const result = await operation();
      if (result.changed) {
        const record = { fingerprint, expiresAt: now() + ttlMs, result: clone(result) };
        store.idempotencyResults[keyId] = record;
        // Persist the domain mutation and its replay response in one snapshot.
        await persist();
      }
      return result;
    })();
    inFlight.set(keyId, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      inFlight.delete(keyId);
    }
  };
}

module.exports = { createIdempotencyExecutor };
