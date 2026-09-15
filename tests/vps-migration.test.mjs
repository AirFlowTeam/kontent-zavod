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

test('bulk receipt migration preserves legacy update IDs and enables multiple items atomically', (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), 'kontent-bulk-migration-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = resolve(dir, 'fixture.sqlite'), backup = resolve(dir, 'before.sqlite');
  const root = resolve(import.meta.dirname, '..'), db = new DatabaseSync(database);
  for (const name of readdirSync(resolve(root, 'drizzle')).filter((name) => /^000\d_.*\.sql$/.test(name)).sort()) db.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
  db.exec(`INSERT INTO producers(id,name,status,created_at) VALUES(1,'Producer','active','2026-01-01');
    INSERT INTO creators(id,name,type,producer_id,status,created_at) VALUES(1,'Creator','UGC',1,'active','2026-01-01');
    INSERT INTO platforms(id,name,domains,status) VALUES(1,'YouTube','["youtube.com"]','active');
    INSERT INTO creator_channels(id,creator_id,platform_id,url,normalized_url,status,created_at,updated_at) VALUES(1,1,1,'https://youtube.com/@fixture','https://youtube.com/@fixture','active','2026-01-01','2026-01-01');
    INSERT INTO telegram_creator_links(telegram_user_id,creator_id,chat_id,created_at,updated_at) VALUES('2001',1,'2001','2026-01-01','2026-01-01');
    INSERT INTO telegram_submissions(update_id,telegram_user_id,creator_id,channel_id,source_kind,result_status,created_at) VALUES(777,'2001',1,1,'channel','created','2026-01-01');`);
  db.close();
  const args = [resolve(root, 'deploy/vps/migrate-bot-bulk.py'), database, resolve(root, 'drizzle/0010_common_agent_brand.sql'), backup];
  execFileSync('python3', args);
  const migrated = new DatabaseSync(database), original = new DatabaseSync(backup);
  try {
    assert.equal(migrated.prepare('SELECT item_index FROM telegram_submissions WHERE update_id=777').get().item_index, 0);
    assert.equal(original.prepare('SELECT update_id FROM telegram_submissions').get().update_id, 777);
    migrated.exec(`INSERT INTO telegram_submissions(update_id,item_index,telegram_user_id,creator_id,channel_id,source_kind,result_status,created_at) VALUES(777,1,'2001',1,1,'channel','existing','2026-01-01')`);
    assert.equal(migrated.prepare('SELECT count(*) n FROM telegram_submissions WHERE update_id=777').get().n, 2);
    assert.throws(() => migrated.exec(`INSERT INTO telegram_submissions(update_id,item_index,telegram_user_id,creator_id,channel_id,source_kind,result_status,created_at) VALUES(777,0,'2001',1,1,'channel','existing','2026-01-01')`));
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { migrated.close(); original.close(); }
  assert.notEqual(spawnSync('python3', args).status, 0);
});
