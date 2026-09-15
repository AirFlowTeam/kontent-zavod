import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createTelegramUpdateQueue, limitConcurrency } from '../scripts/telegram-update-queue.mjs';

const update = (id, actor) => ({ update_id: id, message: { from: { id: actor } } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('slow video batches do not block another creator; same-creator order and contiguous acknowledgements retained', async () => {
  const slow = deferred(), started = [], done = [];
  const q = createTelegramUpdateQueue({ handle: async (u) => {
    started.push(u.update_id);
    if (u.update_id === 100) await slow.promise;
    done.push(u.update_id);
  } });
  const batch = [update(100, 1), update(101, 1), update(102, 2)];
  q.accept(batch); await tick();
  assert.deepEqual(started, [100, 102]);
  assert.deepEqual(done, [102]);
  assert.equal(q.nextOffset(), 0, 'unfinished first update must not be acknowledged');
  q.accept([...batch, update(103, 3)]); await tick();
  assert.deepEqual(started, [100, 102, 103], 'pending redelivery deduplicated, new actors run');
  slow.resolve(); await tick();
  assert.deepEqual(done, [102, 103, 100, 101]);
  assert.equal(q.nextOffset(), 104);
  assert.equal(q.size, 0);
  q.accept(batch); await tick(); assert.equal(started.length, 4);
});

test('failed update retries only its actor without losing or rerunning later successes', async () => {
  let now = 0;
  const calls = [], retries = [];
  const q = createTelegramUpdateQueue({ now: () => now, onRetry: (_, ms) => retries.push(ms), handle: async (u) => {
    calls.push(u.update_id);
    if (u.update_id === 1 && now === 0) throw new Error('temporary');
  } });
  q.accept([update(1, 1), update(2, 1), update(3, 2)]); await tick();
  assert.deepEqual(calls, [1, 3]); assert.deepEqual(retries, [1000]);
  assert.equal(q.nextOffset(), 0);
  now = 999; q.pump(); await tick(); assert.deepEqual(calls, [1, 3]);
  now = 1000; q.pump(); await tick();
  assert.deepEqual(calls, [1, 3, 1, 2]); assert.equal(q.nextOffset(), 4);
});

test('bounded backlog and shutdown do not acknowledge or launch unfinished work', async () => {
  const slow = deferred(), calls = [];
  const q = createTelegramUpdateQueue({ maxPending: 2, handle: async (u) => { calls.push(u.update_id); await slow.promise; } });
  q.accept([update(10, 1), update(11, 1), update(12, 2)]); await tick();
  assert.equal(q.full, true); assert.equal(q.size, 2); assert.equal(q.nextOffset(), 0);
  q.close(); slow.resolve(); await tick(); assert.deepEqual(calls, [10]);
  assert.equal(q.nextOffset(), 11, 'second update still unacknowledged');
});

test('video resolver concurrency is bounded and capacity released on failures', async () => {
  const limit = limitConcurrency(2), slow = deferred();
  let active = 0, max = 0;
  const jobs = Array.from({ length: 6 }, (_, i) => limit(async () => {
    active += 1; max = Math.max(max, active);
    try { await slow.promise; if (i === 1) throw new Error('parse failed'); return i; }
    finally { active -= 1; }
  }));
  await tick(); assert.equal(active, 2);
  slow.resolve(); const results = await Promise.allSettled(jobs);
  assert.equal(max, 2); assert.equal(active, 0);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
});

test('shutdown cancels queued video resolvers without starting child processes', async () => {
  const stop = new AbortController(), slow = deferred();
  const limit = limitConcurrency(1, { signal: stop.signal });
  const first = limit(() => slow.promise);
  let started = false;
  const waiting = limit(async () => { started = true; });
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  stop.abort(); await rejected;
  slow.resolve(); await first;
  assert.equal(started, false);
  await assert.rejects(limit(async () => { started = true; }), { name: 'AbortError' });
  assert.equal(started, false);
});
