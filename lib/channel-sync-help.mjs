// Shared by the site and Telegram; access errors are not failed link submissions.
export function channelSyncHelp(platformName, status, channel) {
  const missing = channel && ['totalViews', 'publicationCount', 'totalLikes']
    .some((key) => channel[key] === null || channel[key] === undefined);
  const lostAccess = status === 'needs_auth' || channel?.connectionStatus === 'needs_auth';
  if (platformName === 'YouTube' && (channel?.connectionStatus !== 'connected' || lostAccess)) {
    return `Канал сохранён. Откройте /channels → этот канал → «${channel?.connectionStatus ? 'Войти через Google' : 'Подключить YouTube'}». В защищённой форме войдите через Google аккаунтом владельца YouTube-канала и разрешите чтение данных. После подключения ${channel?.status === 'inactive' ? 'возобновите сбор' : 'вернитесь в бот и обновите результат'}. Если вход ещё недоступен, его должен настроить администратор сервиса; передайте продюсеру ссылку на канал. Создавать ключи разработчика не нужно.`;
  }
  if (!lostAccess && status !== 'error' && !(status === 'success' && missing)) return null;
  if (channel?.status === 'inactive') return 'Канал сохранён. Сбор приостановлен: откройте /channels → этот канал → «Возобновить сбор».';
  if (platformName === 'RuTube') {
    if (status === 'success' && channel?.totalViews != null && channel?.publicationCount != null) {
      return 'Просмотры и ролики получены. Лайки используемый публичный источник RuTube не отдаёт: API-ключ для них не запрашиваем. Это ограничение источника; повторное добавление ссылки его не исправит. Полная инструкция — кнопка «Инструкция файлом».';
    }
    return 'Канал сохранён. Ключ RuTube не нужен. Проверьте, открывается ли ссылка на канал без входа в RuTube. Если адрес неверный, нажмите «Изменить ссылку». При временном сбое повторим сбор; если ошибка сохраняется, передайте продюсеру ссылку и текст ошибки без паролей.';
  }
  if (!lostAccess && status === 'error') {
    return 'Канал сохранён. Сбор завершился ошибкой: возможны временный ответ площадки или лимит запросов. Повторим автоматически. Повторно добавлять ссылку и менять рабочее подключение не нужно. Если ошибка сохраняется, передайте продюсеру ссылку, время проверки и текст ошибки без токенов.';
  }
  if (!lostAccess && channel?.connectionStatus === 'connected') {
    return 'Доступ подключён, но площадка передала не все показатели. Проверьте описание источника и время проверки; скрытые и задержанные метрики не заменяются нулями. Повторный вход не гарантирует их появления. Если причина неясна, отправьте продюсеру ссылку и недоступные поля; инструкция — кнопка «Инструкция файлом».';
  }
  const prerequisite = {
    Instagram: 'Для статистики нужен доступ владельца профессионального Instagram-аккаунта «Автор» или «Бизнес».',
    Threads: 'Для статистики нужен доступ именно Threads к профилю и insights. Токен Instagram не подходит.',
    TikTok: 'Для статистики нужен вход владельца через TikTok с доступом к профилю, статистике и списку видео.',
    VK: 'Для статистики нужен пользовательский доступ VK ID с правом video. Ключ сообщества не подходит.',
    YouTube: 'Войдите через Google аккаунтом владельца YouTube-канала и разрешите чтение данных.',
  }[platformName] || 'Для статистики нужен доступ владельца канала.';
  const setup = 'Если вход не настроен, сначала приложение сервиса подключает администратор: передайте продюсеру название площадки и ссылку.';
  return `Канал сохранён. ${prerequisite} В боте: /channels → этот канал → «${lostAccess && channel?.connectionStatus ? 'Войти заново' : `Подключить ${platformName}`}». ${setup} Пошаговая инструкция и файл — в «Помощи». Повторно добавлять ссылку не нужно. Пароли, коды входа и токены в чат не отправляйте.`;
}

export function channelCoverage(source) {
  if (source === 'threads-api-own-root-posts') return 'Основные собственные посты Threads: текст, фото, видео и карусели. Без репостов, ответов и ghost posts. Просмотры постов, не профиля; не уникальный охват.';
  if (source === 'vk-api-own-added-videos-clips-not-guaranteed') return 'Только собственные видео из доступного альбома «Добавленные». Скрытые видео и отдельные Клипы могут не входить; это не полный итог всего канала.';
  if (source === 'instagram-api-own-video-organic') return 'Опубликованные VIDEO и органические просмотры Instagram, без фото, каруселей, Stories и рекламной статистики. Отсутствующие insights не считаются нулями.';
  return null;
}
