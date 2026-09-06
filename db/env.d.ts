declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SYNC_SECRET?: string;
  }
}
