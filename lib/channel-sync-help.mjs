// Shared by the site and Telegram; access errors are not failed link submissions.
export function channelSyncHelp(platformName, status) {
  if (status !== 'needs_auth') return null;
  if (platformName === 'Instagram') {
    return 'Канал сохранён. Для статистики нужен доступ владельца профессионального Instagram-аккаунта. В боте: /channels → этот канал → «Инструкция площадки» → «Подключить API». Если приложения Meta ещё нет, сначала его настраивает администратор. Пароли и коды входа не отправляйте.';
  }
  return 'Канал сохранён, но площадка ограничила доступ. В боте: /channels → этот канал → «Инструкция площадки» и «Подключить API». Повторно добавлять ссылку не нужно. /social — инструкции всех площадок. Пароли и коды входа не отправляйте.';
}

export function channelCoverage(source) {
  if (source === 'vk-api-own-added-videos-clips-not-guaranteed') return 'Только собственные видео из доступного альбома «Добавленные». Скрытые видео и отдельные Клипы могут не входить; это не полный итог всего канала.';
  if (source === 'instagram-api-own-video-organic') return 'Опубликованные VIDEO и органические просмотры Instagram, без фото, каруселей, Stories и рекламной статистики. Отсутствующие insights не считаются нулями.';
  return null;
}
