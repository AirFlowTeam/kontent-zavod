import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { socialInstructions } from '../lib/social-instructions.mjs';
import { socialGuideFile, socialGuideForm } from '../lib/social-guide-files.mjs';
import { channelSyncHelp } from '../lib/channel-sync-help.mjs';

test('guide documents cover all providers, administrator prerequisites and actual completion', () => {
  const all = socialGuideFile();
  for (const platform of Object.keys(socialInstructions)) {
    assert.ok(all.text.includes(socialInstructions[platform].title));
    const file = socialGuideFile(platform);
    assert.match(file.filename, /^[a-z-]+\.txt$/);
    assert.ok(file.text.includes(socialInstructions[platform].docs));
    assert.match(file.text, /администратор сервиса сначала регистрирует приложение/);
    assert.match(file.text, /не означает, что сбор завершён/);
    assert.doesNotMatch(file.text, /У меня уже есть готовый токен|Ручной вариант|Готовые токены можно ввести|Исправить данные в этой форме/);
  }
  assert.match(all.text, /RuTube: используемый публичный источник не отдаёт лайки/);
  assert.match(all.text, /Клипы.*не гарантируется/);
  assert.throws(() => socialGuideFile('../secrets'), RangeError);
  assert.throws(() => socialGuideFile('toString'), RangeError);
});

test('Telegram attachment is a UTF-8 TXT upload with no user-specific data in its content', async () => {
  const form = socialGuideForm(123456, 'Threads');
  assert.equal(form.get('chat_id'), '123456');
  const file = form.get('document');
  assert.equal(file.name, 'kontent-zavod-threads-guide.txt');
  assert.equal(file.type, 'text/plain;charset=utf-8');
  assert.ok(file.size < 100_000);
  const text = await file.text();
  assert.ok(text.includes(socialInstructions.Threads.title));
  assert.ok(!text.includes('123456'));
  assert.ok(form.get('caption').length < 1024);
});

test('partial metrics explain needed access or known limitations without futile reconnect loops', () => {
  const partial = { totalViews: null, publicationCount: 2, totalLikes: 3 };
  assert.match(channelSyncHelp('YouTube', 'success', partial), /Google/);
  assert.match(channelSyncHelp('TikTok', 'success', partial), /администратор/);
  assert.match(channelSyncHelp('TikTok', 'success', { ...partial, connectionStatus: 'connected' }), /Доступ подключён/);
  assert.doesNotMatch(channelSyncHelp('TikTok', 'error', { ...partial, connectionStatus: 'connected' }), /Подключить API/);
  const rutube = channelSyncHelp('RuTube', 'success', { totalViews: 100, publicationCount: 2, totalLikes: null });
  assert.match(rutube, /не отдаёт/);
  assert.match(rutube, /не запрашиваем/);
  assert.equal(channelSyncHelp('YouTube', 'success', { totalViews: 0, publicationCount: 0, totalLikes: 0, connectionStatus: 'connected' }), null);
  assert.equal(channelSyncHelp('Instagram', 'success'), null);
  assert.match(channelSyncHelp('Instagram', 'needs_auth', { connectionStatus: 'needs_auth' }), /Войти заново/);
});


test('YouTube instructions use official Google login, preserve existing keys and disclose prerequisites', () => {
  for (const platform of [undefined, ...Object.keys(socialInstructions)]) {
    const guide = socialGuideFile(platform).text;
    assert.match(guide, /Подключить YouTube/);
    assert.match(guide, /Войти через Google/);
    assert.match(guide, /youtube\.readonly/);
    assert.match(guide, /Сохранённые ранее ключи продолжают поддерживаться/);
    assert.doesNotMatch(guide, /обязательно подключите свой YouTube API-ключ|Личный YouTube Data API key подключается|Show key|@creols/);
  }
  const guide = socialGuideFile('YouTube').text;
  assert.match(guide, /Brand Account/);
  assert.match(guide, /в том же браузере/);
  assert.match(guide, /Testing.*7 дней/);
  assert.match(guide, /access_denied/);
  assert.match(guide, /ещё требует проверки на реальном аккаунте/);
  assert.match(channelSyncHelp('YouTube', 'success', { totalViews: 0, publicationCount: 0, totalLikes: 0 }), /Подключить YouTube/);
  assert.match(channelSyncHelp('YouTube', 'pending', {}), /Google/);
});

test('published YouTube guides do not present the historical key test as OAuth proof or leak credentials', async () => {
  for (const path of ['../docs/YOUTUBE-QUICK-START.txt', '../guides/kontent-zavod-guide.html', '../app/api-guide/route.ts']) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(text, /Войти через Google/);
    assert.match(text, /18 сентября 2026/);
    assert.doesNotMatch(text, /@creols|Show key|Подключить личный ключ|Исправить данные в этой форме|При ошибке ручного ввода/);
    assert.doesNotMatch(text, /AIza[A-Za-z0-9_-]{30,}|\/[a-f0-9]{48,}\b/);
  }
});
