"""Reset bot data only after the owner chooses the scope. Dry run by default.
Stop all three services before --apply. A unique verified backup is mandatory.
channels archives links/metrics and revokes access while preserving teams.
all removes accounts, teams, channels and historical records from the live DB.
"""
import argparse
import datetime
import json
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('database', type=Path)
parser.add_argument('--scope', required=True, choices=['channels', 'all'])
parser.add_argument('--apply', action='store_true')
parser.add_argument('--backup', type=Path)
args = parser.parse_args()
if not args.database.is_file():
    raise SystemExit('Database missing')
tables = ['social_oauth_sessions', 'social_connect_tickets', 'social_connections',
          'telegram_channel_rechecks', 'telegram_journey_platforms', 'telegram_submissions',
          'channel_sync_history', 'creator_channels', 'reach_history', 'video_url_aliases',
          'videos', 'telegram_invites', 'telegram_creator_links', 'telegram_producer_links',
          'telegram_accounts', 'creators', 'producers']
os.umask(0o077)
with sqlite3.connect(args.database) as db:
    db.execute('PRAGMA foreign_keys=ON')
    if args.apply:
        # Keep the verified backup and the reset in one writer-reserved interval.
        db.execute('BEGIN IMMEDIATE')
    existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not set(tables).issubset(existing):
        raise SystemExit('Apply current migrations first')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise SystemExit('Database integrity check failed')
    print(json.dumps({'scope': args.scope, 'apply': args.apply,
                      'counts': {t: db.execute('SELECT count(*) FROM ' + t).fetchone()[0] for t in tables}}))
    if not args.apply:
        raise SystemExit(0)
    if not args.backup or args.backup.exists() or args.backup.resolve() == args.database.resolve():
        raise SystemExit('Unique backup path required')
    fd = os.open(args.backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(args.backup) as backup:
        source.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or backup.execute('PRAGMA foreign_key_check').fetchall():
            raise SystemExit('Backup integrity check failed')
    if args.scope == 'all':
        for table in tables:
            db.execute('DELETE FROM ' + table)
    else:
        for table in tables[:5]:
            db.execute('DELETE FROM ' + table)
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        db.execute("""UPDATE creator_channels SET deleted_at=?,status='inactive',
          normalized_url='deleted:'||id||':'||normalized_url, provider_channel_id=NULL,handle=NULL,
          next_sync_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE deleted_at IS NULL""", (now, now))
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed; reset rolled back')
print('Reset completed; private backup retained')
