import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');

export function storageHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(resolve(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8'));
  }
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    async first(column) {
      const value = sqlite.prepare(sql).get(...args);
      return column ? value?.[column] ?? null : value ?? null;
    },
    async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
    execute() {
      const result = sqlite.prepare(sql).run(...args);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    async run() { return this.execute(); },
  });
  const DB = {
    prepare: (sql) => statement(sql),
    async batch(items) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = items.map((item) => item.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, SYNC_SECRET: 'fixture-secret-for-service-auth-and-invitations' };
  const cache = new Map();
  function load(relative) {
    const path = resolve(root, relative);
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} };
    cache.set(path, loaded);
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    // Test-only evaluation of our own checked-in TS, never user input.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('require', 'module', 'exports', output)((name) => {
      if (name === 'cloudflare:workers') return { env };
      if (name.startsWith('@/')) return name.endsWith('.mjs') ? require(resolve(root, name.slice(2))) : load(`${name.slice(2)}.ts`);
      return require(name);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  return { sqlite, DB, env, load, close: () => sqlite.close() };
}

export async function onboard(h, { producerId = '1001', creatorId = '2001', type = 'UGC', updateId = 1 } = {}) {
  const flow = h.load('db/telegram-onboarding.ts');
  await flow.selectTelegramRole({ telegramUserId: producerId, role: 'producer', displayName: 'Producer' });
  const invite = await flow.createTelegramInvite({ telegramUserId: producerId, updateId });
  await flow.acceptTelegramInvite({ telegramUserId: creatorId, token: invite.token, displayName: 'Creator' });
  const context = await flow.selectTelegramCreatorType({ telegramUserId: creatorId, type });
  return { flow, invite, context };
}
