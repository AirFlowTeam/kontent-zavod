// Shared by the site and Telegram; access errors are not failed link submissions.
export function channelSyncHelp(platformName, status) {
  if (status !== 'needs_auth') return null;
  if (platformName === 'Instagram') {
    return 'Канал сохранён. Instagram не предоставляет статистику без авторизованного доступа. Подключение аккаунта владельца через Instagram/Meta пока не настроено — это задача администратора платформы. Повторно добавлять ссылку не нужно. Не отправляйте пароль или коды входа в бот.';
  }
  return 'Канал сохранён, но площадка ограничила доступ к данным. Администратору нужно проверить подключение площадки. Повторно добавлять ссылку не нужно. Не отправляйте пароль или коды входа в бот.';
}
