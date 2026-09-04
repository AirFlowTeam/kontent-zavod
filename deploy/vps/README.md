# VPS deployment

The VPS deployment runs the Vinext Worker as a single `systemd` service behind
the host Nginx instance.

- Public host: `https://kontent-zavod.87-199-207-149.sslip.io`
- Worker listener: `127.0.0.1:18082`
- Application releases: `/opt/kontent-zavod/releases`
- Current release symlink: `/opt/kontent-zavod/current`
- Persistent local D1 state: `/var/lib/kontent-zavod/state`
- Service: `kontent-zavod.service`

The Worker must run as a single process because its D1 binding is backed by
local Miniflare state. Keep the state directory outside release folders and do
not commit Nginx Basic Auth credentials or other secrets.
