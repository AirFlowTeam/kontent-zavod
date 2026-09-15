"""Interactive server-only API setup. Never puts secrets in argv, logs or source.
Run as root in an SSH terminal, then restart app + collector. Existing passwords
and bot/vault secrets are never read back to the terminal or modified.
"""
import argparse
import getpass
import grp
import os
import re
import secrets
import shutil
import tempfile
from pathlib import Path

fields = {
    'instagram': ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
    'threads': ['THREADS_CLIENT_ID', 'THREADS_CLIENT_SECRET'],
    'tiktok': ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    'vk': ['VK_CLIENT_ID', 'VK_SERVICE_TOKEN'],
    'youtube': ['YOUTUBE_API_KEY'],
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('provider', choices=fields)
args = parser.parse_args()
if os.geteuid() != 0:
    raise SystemExit('Run as root on the deployment server')
path = Path('/etc/kontent-zavod/sync.env')
if not path.is_file() or path.is_symlink():
    raise SystemExit('Expected regular environment file missing')
os.umask(0o077)
original = path.read_text()
existing = {line.split('=', 1)[0]: line.split('=', 1)[1] for line in original.splitlines() if '=' in line and not line.startswith('#')}
updates = {}
print('Paste values from your approved application. Input is hidden. Blank keeps existing value.')
for key in fields[args.provider]:
    value = getpass.getpass(key + ': ').strip()
    if not value:
        if not existing.get(key):
            raise SystemExit('Required setting absent; no changes saved: ' + key)
        continue
    if len(value) > 8192 or not re.fullmatch(r'[A-Za-z0-9._~+/=:\-]+', value):
        raise SystemExit('Invalid characters; no changes saved')
    if key.endswith('CLIENT_ID') and not value.isdigit():
        raise SystemExit('Client ID must be numeric; no changes saved')
    updates[key] = value
if args.provider != 'youtube':
    print('Enable only for permitted test users or after platform approval. Setup alone does not grant video access.')
    enabled = input('Enable official sign-in now? Type YES; anything else keeps it disabled: ').strip() == 'YES'
    updates[args.provider.upper() + '_OAUTH_ENABLED'] = 'true' if enabled else 'false'
if not updates:
    raise SystemExit('No changes')
lines = [line for line in original.splitlines() if line.split('=', 1)[0] not in updates]
lines += [key + '=' + value for key, value in updates.items()]
backup = path.with_name(path.name + '.before-api-' + secrets.token_hex(6))
shutil.copy2(path, backup)
fd, temporary = tempfile.mkstemp(prefix='.api-env-', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as output:
        output.write('\n'.join(lines) + '\n')
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o640)
    os.chown(temporary, 0, grp.getgrnam('kontentzavod').gr_gid)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print('Saved with recoverable backup. Restart kontent-zavod and kontent-zavod-sync, then check Integrations in the admin dashboard.')
