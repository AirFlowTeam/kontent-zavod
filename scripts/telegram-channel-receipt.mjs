export function channelSubmissionReceipt(channel) {
  const ownAccess = channel.creatorMatch && channel.platformName !== 'RuTube';
  const extra = { reply_markup: { inline_keyboard: [
    ...(ownAccess && channel.platformName === 'YouTube' ? [
      [{ text: 'Подключить YouTube', callback_data: `social:connect:${channel.id}` }],
    ] : ownAccess ? [[{ text: `Подключить мой ${channel.platformName}`, callback_data: `social:connect:${channel.id}` }]] : []),
    ...(ownAccess ? [[{ text: 'Как получить доступ · пошагово', callback_data: `social:help:${channel.platformName}` }]] : []),
    ...(!ownAccess ? [[{ text: '＋ Добавить ещё ссылки', callback_data: 'menu:add-channel' }]] : []),
    [{ text: 'Мои каналы', callback_data: 'menu:channels' }],
  ] } };
  if (channel.status === 'deleted') return { text: 'Этот канал был удалён. Повтор старого действия ничего не изменил. Чтобы добавить его снова, отправьте ссылку новым сообщением.' };
  if (channel.status === 'inactive') return { text: channel.creatorMatch
    ? `⚠️ Этот канал уже есть, но сбор приостановлен. Откройте «Мои каналы» → «Возобновить сбор».\n${channel.normalizedUrl}`
    : `⚠️ Этот канал уже есть в платформе, но отключён. Ничего не менял.\n${channel.normalizedUrl}` };
  if (channel.resultStatus === 'created') {
    const nextStep = channel.platformName === 'RuTube' ? 'Ключ не нужен: первая проверка уже в очереди.'
      : channel.platformName === 'YouTube' ? 'Следующий шаг — нажмите «Подключить YouTube» и войдите через Google аккаунтом владельца канала. Разрешите чтение данных, вернитесь в бот и обновите результат.'
        : 'Следующий шаг — подключите личный доступ кнопкой ниже. Войдите аккаунтом владельца и разрешите чтение статистики.';
    return { text: `✅ Канал добавлен к «${channel.creatorName}»\n${channel.normalizedUrl}\n\n${nextStep}\nПоказатели обновляются раз в сутки. Можно прислать следующий канал.`, extra };
  }
  if (channel.creatorMatch) return { text: `✅ Этот канал уже привязан к «${channel.creatorName}»\n${channel.normalizedUrl}\n\nПовторно добавлять его не нужно. Можно проверить доступ или добавить другие ссылки.`, extra };
  return { text: `⚠️ Этот канал уже привязан к другому креатору. Ничего не менял.\n${channel.normalizedUrl}` };
}
