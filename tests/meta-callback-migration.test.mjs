import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = resolve(root, 'drizzle/0012_meta_callbacks.sql');
const script = resolve(root, 'deploy/vps/migrate-meta-callbacks.py');
function fixture(t) {
  const directory = mkdtempSync(resolve(tmpdir(), 'kz-meta-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = resolve(directory, 'before.sqlite');
  const backup = resolve(directory, 'private-backup.sqlite');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(resolve(root, 'drizzle')).filter((file) => file.endsWith('.sql') && file < '0012').sort()) db.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8'));
  db.prepare("INSERT INTO app_meta(key,value) VALUES('retained','fixture-marker')").run();
  db.close();
  return { directory, database, backup };
}
const run = (database, backup, sql = migration) => spawnSync('python3', [script, database, sql, backup], { encoding: 'utf8', timeout: 10_000 });
function snapshot(database) {
  const db = new DatabaseSync(database);
  try { return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()])); }
  finally { db.close(); }
}

test('Meta migration adds only empty callback tables and preserves a private verified backup', (t) => {
  const { database, backup } = fixture(t), before = snapshot(database);
  const result = run(database, backup);
  assert.equal(result.status, 0, result.stderr);
  const after = snapshot(database);
  assert.deepEqual(after.meta_account_links, []); assert.deepEqual(after.meta_callback_receipts, []);
  delete after.meta_account_links; delete after.meta_callback_receipts;
  assert.deepEqual(after, before); assert.deepEqual(snapshot(backup), before);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
});

test('Meta migration refuses duplicate/partial state and unreviewed SQL before a new backup is made', (t) => {
  const { database, backup, directory } = fixture(t);
  assert.equal(run(database, backup).status, 0);
  const second = resolve(directory, 'second.sqlite');
  assert.notEqual(run(database, second).status, 0); assert.equal(existsSync(second), false);
  const changed = resolve(directory, 'changed.sql'); writeFileSync(changed, readFileSync(migration, 'utf8') + '\n-- modified\n');
  assert.notEqual(run(database, second, changed).status, 0); assert.equal(existsSync(second), false);
});

test('Meta migration rolls back both new tables on a late DDL error and keeps the original backup', (t) => {
  const { database, backup } = fixture(t);
  const db = new DatabaseSync(database);
  db.exec('CREATE INDEX idx_meta_callback_subject ON creator_channels(id)'); db.close();
  const before = snapshot(database);
  const result = run(database, backup);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /already exists/);
  assert.deepEqual(snapshot(database), before); assert.deepEqual(snapshot(backup), before);
});
