'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdempotencyExecutor } = require('./idempotency');

function setup(options = {}) {
  const store = { idempotencyResults: {}, effects: 0 };
  let writes = 0;
  const execute = createIdempotencyExecutor({
    store,
    persist: async () => { writes += 1; },
    ...options,
  });
  const operation = async () => {
    store.effects += 1;
    return { status: 201, payload: { id: `record-${store.effects}` }, changed: true };
  };
  const request = (key, actorId = 'user-1', payload = { amount: 100 }) => ({ actorId, scope: 'course:one:enroll', key, payload });
  return { execute, operation, request, store, get writes() { return writes; } };
}

test('concurrent duplicate requests execute one mutation and share the result', async () => {
  const ctx = setup();
  let runs = 0;
  const operation = async () => {
    runs += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    ctx.store.effects += 1;
    return { status: 201, payload: { id: 'one' }, changed: true };
  };
  const [first, second] = await Promise.all([
    ctx.execute(ctx.request('retry-key-0001'), operation),
    ctx.execute(ctx.request('retry-key-0001'), operation),
  ]);
  assert.equal(runs, 1);
  assert.deepEqual(first, second);
  assert.equal(ctx.store.effects, 1);
  assert.equal(ctx.writes, 1);
});

test('a retry after a lost response replays the committed response', async () => {
  const ctx = setup();
  const first = await ctx.execute(ctx.request('retry-key-0002'), ctx.operation);
  const retry = await ctx.execute(ctx.request('retry-key-0002'), ctx.operation);
  assert.deepEqual(retry, first);
  assert.equal(ctx.store.effects, 1);
  assert.equal(ctx.writes, 1);
});

test('reusing a key with a different payload is rejected without another mutation', async () => {
  const ctx = setup();
  await ctx.execute(ctx.request('retry-key-0003'), ctx.operation);
  const conflict = await ctx.execute(ctx.request('retry-key-0003', 'user-1', { amount: 200 }), ctx.operation);
  assert.equal(conflict.status, 409);
  assert.equal(ctx.store.effects, 1);
});

test('idempotency keys are isolated by actor and operation scope', async () => {
  const ctx = setup();
  const first = await ctx.execute(ctx.request('retry-key-0004', 'user-1'), ctx.operation);
  const second = await ctx.execute(ctx.request('retry-key-0004', 'user-2'), ctx.operation);
  assert.notDeepEqual(second, first);
  const otherOperation = await ctx.execute({ ...ctx.request('retry-key-0004'), scope: 'assignment:two:submit' }, ctx.operation);
  assert.notDeepEqual(otherOperation, first);
  assert.equal(ctx.store.effects, 3);
});

test('failed operations are not cached and can be retried', async () => {
  const ctx = setup();
  await assert.rejects(ctx.execute(ctx.request('retry-key-0005'), async () => {
    throw new Error('temporary storage failure');
  }), /temporary storage failure/);
  const recovered = await ctx.execute(ctx.request('retry-key-0005'), ctx.operation);
  assert.equal(recovered.status, 201);
  assert.equal(ctx.store.effects, 1);
  assert.equal(ctx.writes, 1);
});

test('expired replay entries allow a later intentional operation', async () => {
  let timestamp = 10_000;
  const ctx = setup({ ttlMs: 10, now: () => timestamp });
  await ctx.execute(ctx.request('retry-key-0006'), ctx.operation);
  timestamp += 11;
  await ctx.execute(ctx.request('retry-key-0006'), ctx.operation);
  assert.equal(ctx.store.effects, 2);
});
