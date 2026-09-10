# VPS deployment

The VPS deployment runs the Vinext Worker as a single `systemd` service behind
the host Nginx instance.

- Current VPS: `217.60.183.146`; Worker listener: `127.0.0.1:18084`
- Dashboard: `https://kontent-zavod.217-60-183-146.sslip.io:21443/`
- Unit templates retain the original server ports; preserve the current host's installed configuration when deploying.
- Application releases: `/opt/kontent-zavod/releases`
- Current release symlink: `/opt/kontent-zavod/current`
- Persistent local D1 state: `/var/lib/kontent-zavod/state`
- Service: `kontent-zavod.service`
- Always-on channel collector: `kontent-zavod-sync.service` (no cron)
- Telegram creator bot: `kontent-zavod-telegram.service` (long polling, no cron)
- Collector credentials: `/etc/kontent-zavod/sync.env` (`0640`, owned by
  `root:kontentzavod`, never committed)
- Telegram token: `/etc/kontent-zavod/telegram.env` (`0640`, owned by
  `root:kontentzavod`, never committed)

The Worker must run as a single process because its D1 binding is backed by
local Miniflare state. Keep the state directory outside release folders and do
not commit Nginx Basic Auth credentials or other secrets.

The collector claims due channels from the loopback-only `/api/sync` endpoint
and updates successful channels every 24 hours (first collection immediately).
Failed requests use bounded retries; expired leases recover after a restart.
It uses YouTube Data API when `YOUTUBE_API_KEY` is configured, RuTube's
first-party profile API (including `/u/name` resolution), TikTok and Instagram
public profile JSON, and VK API when `VK_API_TOKEN` is configured. `yt-dlp` is a
best-effort fallback. It never stores individual publications. Optional
`YTDLP_COOKIES_FILE` and `PARSER_PROXY_URL` values can be added to `sync.env`
for authorized sessions. Cookies are copied to a temporary writable file per run.
Missing metrics stay null; sampled video views are never passed off as channel
totals or 30-day unique reach. A provider returning no metrics fails explicitly.

The bot works only in private chats. `/start` offers producer and creator roles.
A producer gets an isolated team and creates one-recipient, seven-day invitations.
Creators open their producer's invite and choose AI or UGC once for all their
channels before submitting channel or video links. Every channel retains both
owners' Telegram IDs (usernames optional), shown in bot, dashboard and export.
`/role` changes only one's own role, never ownership. Video URLs
are used transiently to resolve the channel and are never stored. The bot calls
the loopback-only `/api/telegram` endpoint with the service credential already
used by the collector.

The old arbitrary creator selector and shared invite code are disabled. Existing
server tokens and admin allowlist are preserved but do not bypass ownership.
Legacy creator links must confirm their type and have a linked producer before
submitting. Do not infer Telegram ownership from a display name.

Schema is managed by `drizzle/*.sql`, not DDL on every HTTP request. Back up the
persistent database before applying additive migrations and changing the release
symlink. On the original runtime-created schema, apply only the verified missing
migration; do not replay earlier CREATE TABLE migrations blindly.

Extract release archives with `--no-same-owner`. Before startup, create writable
`.wrangler` and `dist/server/.wrangler/tmp` directories in the new release,
owned by `kontentzavod:kontentzavod` (0750). The remaining source can stay read-only.
Do not regard `systemctl is-active` as readiness: verify `/api/data` and logs too.

`memory-resilience.conf` is a drop-in for this app service only. A low soft memory
limit previously left workerd indefinitely throttled instead of restarting.
Keep the 1 GiB hard cap and OOM restart; do not restore the old MemoryHigh=768M.

Validation: `npm test`, `npm run lint`, `npx tsc --noEmit`, then the Sites build
helper. Tests use isolated SQLite databases and fake Telegram delivery; no real
users receive test messages. Live public checks do not prove private access or
future upstream availability. VK requires its API token; YouTube fallback may
provide only subscriber counts. Private reach/analytics require owner permissions.
