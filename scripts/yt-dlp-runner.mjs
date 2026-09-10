import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function runYtDlp(url, { binary = '/usr/local/bin/yt-dlp', timeoutMs = 180_000,
  playlistLimit = 120, metadataOnly = false, video = false, cookieFile, proxyUrl, signal } = {}) {
  let temporary;
  try {
    const args = ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--dump-single-json',
      '--skip-download', '--socket-timeout', '20', '--retries', '1', '--quiet', '--no-warnings'];
    if (video) args.push('--no-playlist');
    else args.push('--flat-playlist', '--playlist-end', String(Math.min(500, Math.max(10, playlistLimit))));
    if (metadataOnly) args.push('--playlist-items', '0');
    if (cookieFile) {
      temporary = await mkdtemp(join(tmpdir(), 'kontent-parser-'));
      const writableCookieFile = join(temporary, 'cookies.txt');
      await copyFile(cookieFile, writableCookieFile);
      await chmod(writableCookieFile, 0o600);
      args.push('--cookies', writableCookieFile);
    }
    if (proxyUrl) args.push('--proxy', proxyUrl);
    args.push('--', url);
    const allowed = ['PATH', 'LANG', 'LC_ALL', 'HOME', 'TMPDIR', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'];
    const environment = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Сборщик остановлен'));
      const child = spawn(binary, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = ''; let stderr = ''; let bytes = 0; let timedOut = false; let oversized = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, Math.min(300_000, Math.max(10_000, timeoutMs)));
      const stop = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', stop, { once: true });
      function cleanup() { clearTimeout(timeout); signal?.removeEventListener('abort', stop); }
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 8_000_000) { oversized = true; child.kill('SIGKILL'); }
        else stdout += chunk;
      });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
      child.once('error', () => { cleanup(); reject(new Error('Не удалось запустить yt-dlp')); });
      child.once('close', (code) => {
        cleanup();
        if (signal?.aborted) return reject(new Error('Сборщик остановлен'));
        if (timedOut) return reject(new Error('Превышено время ожидания парсера'));
        if (oversized) return reject(new Error('Ответ парсера слишком большой'));
        if (code !== 0 || !stdout.trim()) {
          let message = stderr || `yt-dlp завершился с кодом ${code}`;
          for (const secret of [proxyUrl, cookieFile, temporary]) if (secret) message = message.split(secret).join('[скрыто]');
          return reject(new Error(message.replace(/\s+/g, ' ').slice(0, 900)));
        }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Парсер вернул некорректный JSON')); }
      });
    });
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
