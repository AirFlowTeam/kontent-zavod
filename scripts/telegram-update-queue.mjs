// Telegram retains unacknowledged updates. Advance its offset only past a fully
// completed prefix, so a restart cannot lose an in-flight channel submission.
export function createTelegramUpdateQueue({ handle, onRetry = () => {}, now = Date.now, maxPending = 100 }) {
  const entries = new Map(), runningActors = new Set();
  let offset = 0, closed = false;
  const ordered = () => [...entries.values()].sort((a, b) => a.update.update_id - b.update.update_id);
  function pump() {
    if (closed) return;
    const blocked = new Set(runningActors);
    for (const entry of ordered()) {
      if (entry.done || entry.running) continue;
      if (blocked.has(entry.actor)) continue;
      blocked.add(entry.actor);
      if (entry.retryAt > now()) continue;
      entry.running = true;
      runningActors.add(entry.actor);
      Promise.resolve().then(() => handle(entry.update)).then(() => {
        entry.done = true;
      }, (error) => {
        entry.failures += 1;
        const retryInMs = error?.retryAfter > 0
          ? Math.min(60_000, error.retryAfter * 1_000)
          : Math.min(30_000, 1_000 * 2 ** Math.min(entry.failures - 1, 5));
        entry.retryAt = now() + retryInMs;
        onRetry(error, retryInMs);
      }).finally(() => {
        entry.running = false;
        runningActors.delete(entry.actor);
        pump();
      });
    }
  }
  return {
    get size() { return entries.size; },
    get full() { return entries.size >= maxPending; },
    accept(updates) {
      if (closed) return;
      for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
        if (!Number.isSafeInteger(update.update_id) || update.update_id < offset || entries.has(update.update_id)) continue;
        if (entries.size >= maxPending) break;
        const actor = String(update.message?.from?.id ?? update.callback_query?.from?.id ?? `update:${update.update_id}`);
        entries.set(update.update_id, { update, actor, done: false, running: false, failures: 0, retryAt: 0 });
      }
      pump();
    },
    nextOffset() {
      for (const entry of ordered()) {
        if (!entry.done) break;
        offset = entry.update.update_id + 1;
        entries.delete(entry.update.update_id);
      }
      return offset;
    },
    pump,
    close() { closed = true; },
  };
}

export function limitConcurrency(limit, { signal } = {}) {
  let active = 0;
  const waiting = [];
  async function run(task) {
    signal?.throwIfAborted();
    if (active >= limit) await new Promise((resolve, reject) => {
      const entry = { resolve, abort: () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      } };
      waiting.push(entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
    });
    else active += 1;
    try { signal?.throwIfAborted(); return await task(); }
    finally {
      const next = waiting.shift();
      if (next) { signal?.removeEventListener('abort', next.abort); next.resolve(); }
      else active -= 1;
    }
  }
  return run;
}
