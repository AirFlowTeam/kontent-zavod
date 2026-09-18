import { channelInstructions } from './channel-instructions.mjs';

export const journeyPlatforms = Object.keys(channelInstructions);
export const metricNames = { totalViews: 'просмотры', publicationCount: 'публикации', totalLikes: 'лайки' };
export const missingMetrics = (channel) => Object.keys(metricNames).filter((key) => channel[key] === null || channel[key] === undefined);

// Completion reflects the actual response, never just a saved URL or OAuth success.
export function channelJourney(channel) {
  const missing = missingMetrics(channel);
  if (channel.platformName === 'YouTube' && (channel.connectionStatus !== 'connected' || channel.syncStatus === 'needs_auth')) {
    return { state: 'access', label: channel.connectionStatus ? 'нужно заново войти через Google' : 'нужно подключить YouTube через Google', action: channel.connectionStatus ? 'Войти через Google' : 'Подключить YouTube', callback: `social:connect:${channel.id}`, missing };
  }
  if (channel.status === 'inactive') return { state: 'paused', label: 'сбор приостановлен', action: 'Возобновить сбор', callback: `channel:resume:${channel.id}`, missing };
  if (channel.connectionStatus === 'needs_auth' || channel.syncStatus === 'needs_auth') {
    return channel.platformName === 'RuTube'
      ? { state: 'check', label: 'нужна проверка источника', action: 'Проверить сбор', callback: `channel:check:${channel.id}`, missing }
      : { state: 'access', label: 'нужно подключить доступ', action: channel.connectionStatus ? 'Войти заново' : `Подключить ${channel.platformName}`, callback: `social:connect:${channel.id}`, missing };
  }
  if (channel.syncStatus === 'success' && !missing.length && channel.parserSource === 'vk-api-own-added-videos-clips-not-guaranteed') {
    return { state: 'limited', label: 'показатели доступных видео получены; полный охват Клипов не подтверждён', action: 'Ограничения VK', callback: 'social:help:VK', missing };
  }
  if (channel.syncStatus === 'success' && !missing.length) return { state: 'ready', label: 'показатели получены', action: 'Показать показатели', callback: `channel:show:${channel.id}`, missing };
  if (channel.syncStatus === 'success' && channel.platformName === 'RuTube' && missing.length === 1 && missing[0] === 'totalLikes') {
    return { state: 'limited', label: 'просмотры и ролики получены; лайки недоступны у источника', action: 'Ограничения RuTube', callback: 'social:help:RuTube', missing };
  }
  if (missing.length && channel.platformName !== 'RuTube' && channel.connectionStatus !== 'connected') {
    return { state: 'access', label: `не получены: ${missing.map((key) => metricNames[key]).join(', ')}; нужно подключить аккаунт`, action: `Подключить ${channel.platformName}`, callback: `social:connect:${channel.id}`, missing };
  }
  return { state: 'check', label: channel.syncStatus === 'pending' ? 'проверка в очереди' : `нужна проверка${missing.length ? `; не получены: ${missing.map((key) => metricNames[key]).join(', ')}` : ''}`, action: 'Проверить сбор', callback: `channel:check:${channel.id}`, missing };
}

export function socialJourney(channels, skippedPlatforms = []) {
  const platforms = journeyPlatforms.map((platformName) => {
    const own = channels.filter((channel) => channel.platformName === platformName);
    const states = own.map((channel) => ({ channel, ...channelJourney(channel) }));
    return { platformName, channels: own, states, skipped: !own.length && skippedPlatforms.includes(platformName),
      unresolved: !own.length && !skippedPlatforms.includes(platformName) };
  });
  const states = platforms.flatMap((platform) => platform.states);
  return { platforms, states, nextPlatform: platforms.find((platform) => platform.unresolved),
    nextChannel: states.find((item) => !['ready', 'limited'].includes(item.state)),
    reviewed: platforms.filter((platform) => !platform.unresolved).length,
    ready: states.filter((item) => item.state === 'ready').length,
    limited: states.filter((item) => item.state === 'limited').length,
    complete: platforms.every((platform) => !platform.unresolved) && states.every((item) => ['ready', 'limited'].includes(item.state)) };
}
