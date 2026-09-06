# VPS deployment

The VPS deployment runs the Vinext Worker as a single `systemd` service behind
the host Nginx instance.

- Public host: `https://kontent-zavod.87-199-207-149.sslip.io`
- Worker listener: `127.0.0.1:18082`
- Application releases: `/opt/kontent-zavod/releases`
- Current release symlink: `/opt/kontent-zavod/current`
- Persistent local D1 state: `/var/lib/kontent-zavod/state`
- Service: `kontent-zavod.service`
- Always-on channel collector: `kontent-zavod-sync.service` (no cron)
- Collector credentials: `/etc/kontent-zavod/sync.env` (`0640`, owned by
  `root:kontentzavod`, never committed)

The Worker must run as a single process because its D1 binding is backed by
local Miniflare state. Keep the state directory outside release folders and do
not commit Nginx Basic Auth credentials or other secrets.

The collector claims due channels from the loopback-only `/api/sync` endpoint
and uses the YouTube Data API when `YOUTUBE_API_KEY` is configured, RuTube's
first-party public profile endpoint for numeric channel IDs, and `yt-dlp` as a
best-effort fallback. It never stores individual publications. Optional
`YTDLP_COOKIES_FILE` and `PARSER_PROXY_URL` values can be added to `sync.env`
for providers that require an authenticated session.
