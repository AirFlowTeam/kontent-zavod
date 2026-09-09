import assert from 'node:assert/strict';
import test from 'node:test';

import {
  channelCandidatesFromInfo,
  channelDescriptorsFromInfo,
  directChannelDescriptor,
  extractMessageUrl,
  inspectSubmittedUrl,
  parseTelegramAdminUserIds,
} from '../scripts/telegram-bot-lib.mjs';

test('parses a strict persistent Telegram admin allowlist', () => {
  assert.deepEqual([...parseTelegramAdminUserIds('1053499153, 42,1053499153')], [
    '1053499153',
    '42',
  ]);
  assert.equal(parseTelegramAdminUserIds('').size, 0);
  assert.throws(() => parseTelegramAdminUserIds('0'));
  assert.throws(() => parseTelegramAdminUserIds('1053499153,'));
  assert.throws(() => parseTelegramAdminUserIds('9007199254740992'));
});

test('extracts a URL entity and strips sentence punctuation', () => {
  assert.equal(
    extractMessageUrl({ text: 'Вот https://youtu.be/demo123).'}),
    'https://youtu.be/demo123',
  );
  assert.equal(
    extractMessageUrl({
      text: 'мой канал',
      entities: [{ type: 'text_link', offset: 0, length: 9, url: 'https://youtube.com/@creator' }],
    }),
    'https://youtube.com/@creator',
  );
});

test('accepts direct channel URLs without resolving a video', () => {
  assert.deepEqual(inspectSubmittedUrl('https://www.youtube.com/@Creator/videos?view=0'), {
    supported: true,
    sourceKind: 'channel',
    needsResolution: false,
    candidates: ['https://youtube.com/@creator'],
  });
  assert.deepEqual(inspectSubmittedUrl('https://rutube.ru/video/person/9988/'), {
    supported: true,
    sourceKind: 'channel',
    needsResolution: false,
    candidates: ['https://rutube.ru/channel/9988'],
  });
});

test('requires authoritative resolution for submitted video URLs', () => {
  for (const url of [
    'https://youtu.be/abc123',
    'https://youtube.com/@someone/shorts/abc123',
    'https://tiktok.com/@someone/video/123456',
    'https://instagram.com/reel/abc123',
    'https://vk.com/video123_456',
    'https://vk.com/feed?z=video-123_456',
  ]) {
    const inspected = inspectSubmittedUrl(url);
    assert.equal(inspected.supported, true, url);
    assert.equal(inspected.sourceKind, 'video', url);
    assert.equal(inspected.needsResolution, true, url);
  }
});

test('rejects unsupported and credential-bearing hosts', () => {
  assert.equal(inspectSubmittedUrl('https://example.com/@creator').supported, false);
  assert.equal(inspectSubmittedUrl('https://user:pass@youtube.com/@creator').supported, false);
});

test('maps YouTube metadata only to a YouTube channel', () => {
  assert.deepEqual(channelCandidatesFromInfo({
    channel_url: 'https://youtube.com/@real',
    uploader_url: 'https://youtube.com/@real',
    channel_id: 'UC123456',
  }, 'https://youtu.be/video'), [
    'https://youtube.com/channel/UC123456',
  ]);
});

test('keeps stable provider identity for backend deduplication', () => {
  assert.deepEqual(channelDescriptorsFromInfo({
    channel_id: 'UC123456',
    uploader_id: '@real_creator',
  }, 'https://youtube.com/shorts/abc'), [{
    url: 'https://youtube.com/channel/UC123456',
    providerChannelId: 'UC123456',
    handle: 'real_creator',
  }]);
  assert.deepEqual(channelDescriptorsFromInfo({
    uploader: 'real_creator',
    channel_id: 'MS4wLjABAAAA-provider',
  }, 'https://tiktok.com/@someone/video/1'), [{
    url: 'https://tiktok.com/@real_creator',
    providerChannelId: 'MS4wLjABAAAA-provider',
    handle: '@real_creator',
  }]);
});

test('derives stable IDs directly when the channel URL contains one', () => {
  assert.deepEqual(directChannelDescriptor('https://youtube.com/channel/UC123456'), {
    url: 'https://youtube.com/channel/UC123456',
    providerChannelId: 'UC123456',
    handle: null,
  });
  assert.deepEqual(directChannelDescriptor('https://vk.com/club7788'), {
    url: 'https://vk.com/club7788',
    providerChannelId: '-7788',
    handle: 'club7788',
  });
});

test('maps provider-specific uploader identities and ignores cross-platform embeds', () => {
  assert.deepEqual(channelCandidatesFromInfo({
    channel_url: 'https://youtube.com/@embedded',
    uploader_id: '7788',
  }, 'https://rutube.ru/video/abc'), ['https://rutube.ru/channel/7788']);

  assert.deepEqual(channelCandidatesFromInfo({
    channel_url: 'https://youtube.com/@embedded',
    uploader_id: '123',
  }, 'https://vk.com/video123_456'), ['https://vk.com/id123']);

  assert.deepEqual(channelCandidatesFromInfo({ uploader: 'real_creator', channel_id: 'numeric-provider-id' },
    'https://tiktok.com/@wrong/video/1'), ['https://tiktok.com/@real_creator']);

  assert.deepEqual(channelCandidatesFromInfo({ channel: 'real.creator', uploader_id: '987654' },
    'https://instagram.com/reel/abc'), ['https://instagram.com/real.creator']);
});

test('finds creator metadata inside playlist and carousel entries', () => {
  assert.deepEqual(channelCandidatesFromInfo({
    _type: 'playlist',
    entries: [{ channel: 'carousel.owner', uploader_id: '112233' }],
  }, 'https://instagram.com/p/abc'), ['https://instagram.com/carousel.owner']);

  assert.deepEqual(channelCandidatesFromInfo({
    _type: 'playlist',
    entries: [{ uploader_id: '551122' }],
  }, 'https://rutube.ru/video/abc'), ['https://rutube.ru/channel/551122']);

  assert.deepEqual(channelDescriptorsFromInfo({ uploader_id: '551122', uploader: 'Общее имя' },
    'https://rutube.ru/video/abc'), [{
    url: 'https://rutube.ru/channel/551122',
    providerChannelId: '551122',
    handle: null,
  }]);
});
