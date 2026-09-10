import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('VPS additive migration preserves records and backup; rerun fails without overwriting', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'kontent-migration-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = resolve(dir, 'fixture.sqlite'), backup = resolve(dir, 'before.sqlite');
  const root = resolve(import.meta.dirname, '..');
  const db = new DatabaseSync(database);
  for (const name of readdirSync(resolve(root, 'drizzle')).filter((name) => /^000[0-5]_.*\.sql$/.test(name)).sort()) db.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
  db.exec("INSERT INTO producers(name, status, created_at) VALUES ('Preserved producer', 'active', '2026-01-01')");
  db.close();
  const args = [resolve(root, 'deploy/vps/migrate-basic-metrics.py'), database, resolve(root, 'drizzle/0006_square_leopardon.sql'), backup];
  execFileSync('python3', args);
  const migrated = new DatabaseSync(database), original = new DatabaseSync(backup);
  try {
    assert.equal(migrated.prepare('SELECT name FROM producers').get().name, 'Preserved producer');
    assert.equal(original.prepare('SELECT name FROM producers').get().name, 'Preserved producer');
    assert.ok(migrated.prepare('PRAGMA table_info(creator_channels)').all().some((c) => c.name === 'total_likes'));
    assert.ok(!original.prepare('PRAGMA table_info(creator_channels)').all().some((c) => c.name === 'total_likes'));
  } finally { migrated.close(); original.close(); }
  assert.notEqual(spawnSync('python3', args).status, 0);
  const unused = resolve(dir, 'unused.sqlite');
  assert.notEqual(spawnSync('python3', [...args.slice(0, -1), unused]).status, 0);
  assert.equal(existsSync(unused), false);
});
