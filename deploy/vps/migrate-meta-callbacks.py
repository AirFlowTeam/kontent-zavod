"""Apply the reviewed additive Meta callback migration with a verified backup.
Stop app, collector and bot services before running. Existing data is preserved.
"""
import argparse
import hashlib
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('database', type=Path)
parser.add_argument('migration', type=Path)
parser.add_argument('backup', type=Path)
args = parser.parse_args()
if not args.database.is_file() or not args.migration.is_file() or args.backup.exists():
    raise SystemExit('Missing input or backup already exists')
raw = args.migration.read_bytes()
if hashlib.sha256(raw).hexdigest() != 'fa592b802e1d4470f54e96f1c1a5ca17e4cd11bd053599b08a764f928798d505':
    raise SystemExit('Not the reviewed Meta callback migration')
os.umask(0o077)
with sqlite3.connect(args.database) as db:
    db.execute('PRAGMA foreign_keys=ON')
    # Reserve the writer before inspecting/copying state. Another connection can
    # read the committed snapshot, but nobody can write between backup and DDL.
    db.execute('BEGIN IMMEDIATE')
    existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'creator_channels', 'creators', 'platforms', 'channel_sync_history', 'telegram_submissions', 'telegram_channel_rechecks', 'social_connect_tickets', 'social_connections', 'social_oauth_sessions'}.issubset(existing):
        raise SystemExit('Prerequisite missing')
    if {'meta_account_links', 'meta_callback_receipts'} & existing:
        raise SystemExit('Already migrated or unexpected partial schema')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise SystemExit('Database integrity check failed')
    counts = {t: db.execute('SELECT count(*) FROM ' + t).fetchone()[0]
              for t in ['creator_channels', 'creators', 'telegram_accounts', 'social_connections']}
    fd = os.open(args.backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(args.backup) as backup:
        source.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or backup.execute('PRAGMA foreign_key_check').fetchall():
            raise SystemExit('Backup integrity check failed')
    for statement in raw.decode().split('--> statement-breakpoint'):
        db.execute(statement.strip())
    for table, count in counts.items():
        if db.execute('SELECT count(*) FROM ' + table).fetchone()[0] != count:
            raise RuntimeError('Existing data changed')
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Meta callback migration applied; existing data unchanged; verified private backup created')
