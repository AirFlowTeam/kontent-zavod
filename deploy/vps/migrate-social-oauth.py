"""Apply reviewed additive OAuth migration once; services must be stopped first."""
import argparse
import hashlib
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('database', type=Path)
parser.add_argument('migration', type=Path)
parser.add_argument('backup', type=Path)
args = parser.parse_args()
if not args.database.is_file() or not args.migration.is_file() or args.backup.exists():
    raise SystemExit('Missing input or backup already exists')
raw = args.migration.read_bytes()
if hashlib.sha256(raw).hexdigest() != 'c1538f926a84d38f73174ca97f1bbeacc929a426b2dea6f73d157ba5e3a4202a':
    raise SystemExit('Not the reviewed OAuth migration')
os.umask(0o077)
with sqlite3.connect(args.database) as connection:
    connection.execute('PRAGMA foreign_keys=ON')
    if connection.execute("SELECT name FROM sqlite_schema WHERE name='social_oauth_sessions'").fetchone():
        raise SystemExit('Migration already applied; inspect before proceeding')
    if len(connection.execute("SELECT name FROM sqlite_schema WHERE name IN ('social_connections','social_connect_tickets')").fetchall()) != 2:
        raise SystemExit('Prerequisite social access migration missing')
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed')
    with sqlite3.connect(args.backup) as backup:
        connection.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity check failed')
    connection.execute('BEGIN IMMEDIATE')
    for statement in raw.decode().split('--> statement-breakpoint'):
        connection.execute(statement.strip())
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Verified backup created; additive OAuth migration applied')
