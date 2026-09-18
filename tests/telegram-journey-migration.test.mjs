import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const migration = resolve(root, 'drizzle/0011_material_deathbird.sql');
const migrationScript = resolve(root, 'deploy/vps/migrate-journey.py');
const resetScript = resolve(root, 'deploy/vps/reset-bot-data.py');
const dataTables = ['social_oauth_sessions', 'social_connect_tickets', 'social_connections',
  'telegram_channel_rechecks', 'telegram_journey_platforms', 'telegram_submissions',
  'channel_sync_history', 'creator_channels', 'reach_history', 'video_url_aliases', 'videos',
  'telegram_invites', 'telegram_creator_links', 'telegram_producer_links', 'telegram_accounts', 'creators', 'producers'];

function fixture(t, migrated = true) {
  const directory = mkdtempSync(resolve(tmpdir(), 'kontent-journey-isolated-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = resolve(directory, 'fixture.sqlite'), backup = resolve(directory, 'private-before.sqlite');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(resolve(root, 'drizzle')).filter((name) => /^\d{4}_.*\.sql$/.test(name) && (migrated || !name.startsWith('0011_'))).sort()) db.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
  db.exec(`INSERT INTO producers(id,name,status,created_at) VALUES(1,'Producer','active','2026-01-01');
    INSERT INTO creators(id,name,type,producer_id,status,created_at) VALUES(1,'Creator','UGC',1,'active','2026-01-01');
    INSERT INTO platforms(id,name,domains,status) VALUES(1,'YouTube','["youtube.com"]','active');
    INSERT INTO telegram_accounts(telegram_user_id,chat_id,role,created_at,updated_at) VALUES('1001','1001','producer','2026-01-01','2026-01-01'),('2001','2001','creator','2026-01-01','2026-01-01');
    INSERT INTO telegram_producer_links(telegram_user_id,producer_id,created_at) VALUES('1001',1,'2026-01-01');
    INSERT INTO telegram_creator_links(telegram_user_id,creator_id,chat_id,type_confirmed_at,created_at,updated_at) VALUES('2001',1,'2001','2026-01-01','2026-01-01','2026-01-01');
    INSERT INTO telegram_invites(token_hash,producer_id,creator_id,created_by,update_id,expires_at,created_at) VALUES('invite-hash',1,1,'1001',77,'2099-01-01','2026-01-01');
    INSERT INTO creator_channels(id,creator_id,platform_id,url,normalized_url,provider_channel_id,handle,status,total_views,lease_token,lease_until,next_sync_at,created_at,updated_at)
      VALUES(1,1,1,'https://youtube.com/@fixture','https://youtube.com/@fixture','provider-id','@fixture','active',42,'old-lease','2099-01-01','2099-01-01','2026-01-01','2026-01-01');
    INSERT INTO channel_sync_history(channel_id,status,observed_at,recorded_at,total_views,creator_type_snapshot,producer_id_snapshot) VALUES(1,'success','2026-01-01','2026-01-01',42,'UGC',1);
    INSERT INTO telegram_submissions(update_id,item_index,telegram_user_id,creator_id,channel_id,source_kind,result_status,created_at) VALUES(78,0,'2001',1,1,'channel','created','2026-01-01');
    INSERT INTO videos(id,creator_id,platform_id,url,normalized_url,published_at,added_at,creator_type_snapshot,producer_id_snapshot) VALUES(1,1,1,'https://youtube.com/watch?v=fixture','https://youtube.com/watch?v=fixture','2026-01-01','2026-01-01','UGC',1);
    INSERT INTO reach_history(video_id,reach,recorded_at) VALUES(1,42,'2026-01-01');
    INSERT INTO video_url_aliases(canonical_url,video_id) VALUES('https://youtu.be/fixture',1);
    INSERT INTO social_connect_tickets(token_hash,channel_id,creator_id,telegram_user_id,expires_at,consumed) VALUES('ticket-hash',1,1,'2001','2099-01-01',2);
    INSERT INTO social_connections(channel_id,creator_id,telegram_user_id,account_id,username,ciphertext,status,updated_at) VALUES(1,1,'2001','provider-id','fixture','private-fixture-ciphertext','connected','2026-01-01');
    INSERT INTO social_oauth_sessions(state_hash,ticket_hash,browser_hash,provider,ciphertext,status,expires_at) VALUES('state-hash','ticket-hash','browser-hash','youtube','private-fixture-oauth','pending','2099-01-01');`);
  if (migrated) db.exec("INSERT INTO telegram_channel_rechecks VALUES(1,'2026-01-01'); INSERT INTO telegram_journey_platforms VALUES(1,'Threads','2026-01-01')");
  db.close();
  return { directory, database, backup };
}

function snapshot(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((row) => ({ ...row }))]));
  } finally { db.close(); }
}

function run(args) { return spawnSync('python3', args, { encoding: 'utf8', timeout: 10_000 }); }
function assertOk(result) { assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr}`); }
function healthy(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
}

test('journey migration keeps all existing records and private backup; reruns and modified SQL are refused', (t) => {
  const { directory, database, backup } = fixture(t, false), before = snapshot(database);
  assertOk(run([migrationScript, database, migration, backup]));
  const after = snapshot(database);
  assert.deepEqual(after.telegram_channel_rechecks, []); assert.deepEqual(after.telegram_journey_platforms, []);
  delete after.telegram_channel_rechecks; delete after.telegram_journey_platforms;
  assert.deepEqual(after, before); assert.deepEqual(snapshot(backup), before);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
  healthy(database); healthy(backup);
  assert.notEqual(run([migrationScript, database, migration, backup]).status, 0);
  const secondBackup = resolve(directory, 'second.sqlite');
  assert.notEqual(run([migrationScript, database, migration, secondBackup]).status, 0);
  assert.equal(existsSync(secondBackup), false);
  const modified = resolve(directory, 'changed.sql'); writeFileSync(modified, readFileSync(migration, 'utf8') + '\n-- unreviewed edit\n');
  assert.notEqual(run([migrationScript, database, modified, secondBackup]).status, 0);
  assert.equal(existsSync(secondBackup), false);
});

test('journey DDL failure rolls back the first new table and retains the pre-migration backup', (t) => {
  const { database, backup } = fixture(t, false), db = new DatabaseSync(database);
  db.exec('CREATE VIEW telegram_journey_platforms AS SELECT 1 AS occupied'); db.close();
  const before = snapshot(database), result = run([migrationScript, database, migration, backup]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.deepEqual(snapshot(database), before); assert.deepEqual(snapshot(backup), before);
  assert.equal(Object.hasOwn(snapshot(database), 'telegram_channel_rechecks'), false);
  healthy(database); healthy(backup);
});

test('journey migration refuses missing prerequisites and foreign-key damage before making a backup', (t) => {
  for (const scenario of ['prerequisite', 'foreign-key']) {
    const { database, backup } = fixture(t, false), db = new DatabaseSync(database);
    if (scenario === 'prerequisite') db.exec('DROP TABLE social_connections');
    else db.exec('PRAGMA foreign_keys=OFF; UPDATE creators SET producer_id=999');
    db.close(); const before = snapshot(database);
    const result = run([migrationScript, database, migration, backup]);
    assert.notEqual(result.status, 0); assert.equal(existsSync(backup), false);
    assert.deepEqual(snapshot(database), before);
  }
});

test('reset is a read-only dry run unless --apply and a unique backup are both supplied', (t) => {
  const { database, backup } = fixture(t), before = snapshot(database);
  for (const scope of ['channels', 'all']) {
    const result = run([resetScript, database, '--scope', scope, '--backup', backup]);
    assertOk(result); assert.equal(JSON.parse(result.stdout).apply, false);
    assert.equal(existsSync(backup), false); assert.deepEqual(snapshot(database), before);
    assert.notEqual(run([resetScript, database, '--scope', scope, '--apply']).status, 0);
    assert.notEqual(run([resetScript, database, '--scope', scope, '--apply', '--backup', database]).status, 0);
    assert.deepEqual(snapshot(database), before);
  }
  writeFileSync(backup, 'do not overwrite');
  assert.notEqual(run([resetScript, database, '--scope', 'all', '--apply', '--backup', backup]).status, 0);
  assert.equal(readFileSync(backup, 'utf8'), 'do not overwrite'); assert.deepEqual(snapshot(database), before);
});

test('channel reset revokes every connection and lease, archives links, preserves teams/history and allows re-adding URLs', (t) => {
  const { database, backup } = fixture(t), before = snapshot(database);
  const result = run([resetScript, database, '--scope', 'channels', '--apply', '--backup', backup]);
  assertOk(result); const after = snapshot(database);
  for (const table of dataTables.slice(0, 5)) assert.deepEqual(after[table], [], table);
  for (const table of dataTables.slice(5).filter((table) => table !== 'creator_channels')) assert.deepEqual(after[table], before[table], table);
  const channel = after.creator_channels[0];
  assert.equal(channel.status, 'inactive'); assert.ok(channel.deleted_at); assert.match(channel.normalized_url, /^deleted:1:/);
  for (const field of ['lease_token', 'lease_until', 'next_sync_at', 'provider_channel_id', 'handle']) assert.equal(channel[field], null, field);
  assert.deepEqual(snapshot(backup), before); assert.equal(statSync(backup).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes('private-fixture')); healthy(database); healthy(backup);
  const db = new DatabaseSync(database); db.exec('PRAGMA foreign_keys=ON');
  db.exec("INSERT INTO creator_channels(creator_id,platform_id,url,normalized_url,provider_channel_id,created_at,updated_at) VALUES(1,1,'https://youtube.com/@fixture','https://youtube.com/@fixture','provider-id','2026-01-02','2026-01-02')");
  assert.equal(db.prepare('SELECT max(id) id FROM creator_channels').get().id, 2); db.close();
});

test('full reset deletes children before parents, keeps platform config and preserves ID monotonicity', (t) => {
  const { database, backup } = fixture(t), before = snapshot(database);
  assertOk(run([resetScript, database, '--scope', 'all', '--apply', '--backup', backup]));
  const after = snapshot(database);
  for (const table of dataTables) assert.deepEqual(after[table], [], table);
  assert.deepEqual(after.platforms, before.platforms); assert.deepEqual(after.sqlite_sequence, before.sqlite_sequence);
  assert.deepEqual(snapshot(backup), before); healthy(database); healthy(backup);
  const db = new DatabaseSync(database);
  db.exec("INSERT INTO producers(name,status,created_at) VALUES('New producer','active','2026-01-02')");
  assert.equal(db.prepare('SELECT id FROM producers').get().id, 2); db.close();
});

test('reset failure rolls back every deleted secret/receipt and keeps a complete recovery copy', (t) => {
  for (const scope of ['channels', 'all']) {
    const { database, backup } = fixture(t), db = new DatabaseSync(database);
    db.exec(scope === 'all'
      ? "CREATE TRIGGER reject_reset BEFORE DELETE ON producers BEGIN SELECT RAISE(ABORT,'fixture reset failure'); END"
      : "CREATE TRIGGER reject_reset BEFORE UPDATE ON creator_channels BEGIN SELECT RAISE(ABORT,'fixture reset failure'); END");
    db.close(); const before = snapshot(database);
    const result = run([resetScript, database, '--scope', scope, '--apply', '--backup', backup]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /fixture reset failure/);
    assert.deepEqual(snapshot(database), before); assert.deepEqual(snapshot(backup), before);
    healthy(database); healthy(backup);
  }
});

test('migration and reset reserve the writer before copying the backup, closing the snapshot race', (t) => {
  for (const migrate of [true, false]) {
    const { database, backup } = fixture(t, !migrate), before = snapshot(database);
    const scriptArgs = migrate ? [migrationScript, database, migration, backup] : [resetScript, database, '--scope', 'all', '--apply', '--backup', backup];
    const probe = `import runpy, sqlite3, sys
original_connect = sqlite3.connect
class ProbedConnection(sqlite3.Connection):
    def backup(self, target, *args, **kwargs):
        writer = original_connect(sys.argv[1], timeout=0)
        try:
            writer.execute("INSERT INTO producers(name,status,created_at) VALUES('race-write','active','2026-01-01')")
            writer.commit()
        except sqlite3.OperationalError as error:
            if 'locked' not in str(error): raise
            print('writer blocked during backup')
        else:
            raise AssertionError('Concurrent mutation succeeded between backup and transaction')
        finally:
            writer.close()
        return super().backup(target, *args, **kwargs)
def connect(*args, **kwargs):
    kwargs['factory'] = ProbedConnection
    return original_connect(*args, **kwargs)
sqlite3.connect = connect
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`;
    const result = run(['-c', probe, ...scriptArgs]);
    assertOk(result); assert.match(result.stdout, /writer blocked during backup/);
    assert.deepEqual(snapshot(backup), before); healthy(database);
  }
});
