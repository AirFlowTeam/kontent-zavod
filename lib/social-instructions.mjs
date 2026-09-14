// Links and prerequisites checked against platform documentation, 2026-09-14.
export const socialInstructions = {
  Instagram: {
    title: 'Instagram: доступ владельца',
    steps: [
      'Нужен профессиональный Instagram-аккаунт «Автор» или «Бизнес». У обычного личного аккаунта нужного API нет. Facebook-страница для Instagram Login не требуется.',
      'Если приложения Meta ещё нет: администратор регистрирует Business-приложение Meta и настраивает Instagram API with Instagram Login. Для чужих аккаунтов нужны App Review и Advanced Access; для собственных тестовых — добавление аккаунта в Dashboard.',
      'В Meta App Dashboard откройте Instagram → API setup with Instagram business login → Generate token рядом со своим аккаунтом. Войдите в Instagram и разрешите instagram_business_basic и instagram_business_manage_insights. Нужен long-lived token из Dashboard, не одночасовой OAuth-токен.',
      'В боте: /channels → свой Instagram → «Подключить API». Откройте персональную форму и вставьте только полученный access token. Проверим совпадение аккаунта с каналом и сохраним доступ за вами.',
      'Токен Dashboard действует 60 дней; действующий long-lived токен старше суток продлеваем автоматически. Отозванный доступ надо подключить заново. Считаем опубликованные VIDEO, без фото, каруселей и Stories. Старые/скрытые insights могут быть недоступны; Meta может задерживать метрики до 48 часов.',
    ],
    docs: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started',
  },
  TikTok: {
    title: 'TikTok: авторизация через приложение',
    steps: [
      'В обычных настройках TikTok API-ключа нет. Администратор должен создать приложение TikTok for Developers, подключить Login Kit и Display API и получить одобрение для production. Sandbox доступен только тестовым пользователям.',
      'Приложение запрашивает user.info.basic, user.info.profile, user.info.stats и video.list. Пользователь входит в свой TikTok и разрешает доступ. Результат OAuth — access_token и refresh_token; это не client_secret приложения.',
      'Если эти токены уже выданы одобренным приложением: /channels → свой TikTok → «Подключить API» → вставить access token и refresh token в защищённую форму. username должен совпасть с каналом.',
      'Access token действует около суток. Для ежедневной работы серверу нужны client_key/client_secret именно того приложения, которое выдало refresh token. Их настраивает администратор, не креатор. Без настройки приложения форма честно покажет, что автоматическое продление пока не готово.',
      'Публичные просмотры суммируем только после полного обхода списка видео. Недоступные и скрытые данные не заменяем нулями.',
    ],
    docs: 'https://developers.tiktok.com/docs/en/display-api-get-started',
  },
  VK: {
    title: 'VK: пользовательский токен с правом video',
    steps: [
      'Ссылки vk.ru, vk.com и vkvideo.ru поддерживаются. Ключ сообщества из «Работа с API» и сервисный ключ НЕ подходят методу video.get.',
      'Администратор регистрирует приложение VK ID и согласует право video с VK: devsupport@corp.vk.com. По документации это право выдаётся в исключительных случаях. Без него обещать сбор всех видео нельзя.',
      'Через VK ID авторизуйтесь в согласованном приложении и разрешите video. Для своего профиля токен должен принадлежать вам; для сообщества требуются права управления этим сообществом.',
      'В боте: /channels → свой VK → «Подключить API». В форму вставьте access_token. Для продления нужны также refresh_token, client_id и device_id из результата авторизации VK ID. Без них одночасовой токен скоро потребует повторного подключения.',
      'Считаются доступные собственные видео из video.get, чужие сохранённые видео исключаются. Полнота отдельной вкладки «Клипы» этим методом не гарантируется; в статусе источника это указано.',
    ],
    docs: 'https://dev.vk.ru/ru/method/video.get',
  },
  YouTube: {
    title: 'YouTube: ключ приложения, а не пароль канала',
    steps: [
      'Для публичных каналов вход каждого креатора не нужен: достаточно ссылки и одного серверного YouTube Data API key. Ключ не подтверждает владение каналом.',
      'Администратор: Google Cloud Console → создать проект → APIs & Services → Library → включить YouTube Data API v3 → Credentials → Create credentials → API key.',
      'Ограничьте ключ API YouTube Data API v3 и исходящим IP сервера 217.60.183.146. Администратор может установить общий YOUTUBE_API_KEY на сервере; каждому креатору создавать ключ не обязательно.',
      'Если у вас уже есть отдельный ключ: /channels → свой YouTube → «Подключить API» → вставить ключ в персональную форму. Он используется только для этого канала.',
      'API собирает просмотры и число публичных роликов, а лайки — по полному списку публичных видео. Без ключа публичный парсер может получить только часть показателей. Лимит API-квоты требует ожидания или изменения квоты у Google.',
    ],
    docs: 'https://developers.google.com/youtube/v3/getting-started',
  },
  RuTube: {
    title: 'RuTube: без ключа',
    steps: [
      'Пришлите в бот ссылку на публичный канал RuTube. Дополнительный ключ, пароль или cookie не нужен.',
      'Собираем опубликованные собственные ролики и просмотры по полному списку, включая короткие видео. Скрытые, удалённые, аудио и прямые эфиры исключаются.',
      'Лайки используемый публичный API RuTube не отдаёт. Подтверждённого пользовательского ключа для этих данных нет: показываем «недоступно», а не ноль. Это ограничение источника, не просьба вручную заполнять показатели.',
    ],
    docs: 'https://rutube.ru/info/to_partners1/',
  },
};

export function socialInstructionText(platform) {
  const info = socialInstructions[platform];
  if (!info) return 'Выберите площадку.';
  return `${info.title}\n\n${info.steps.map((step, i) => `${i + 1}. ${step}`).join('\n\n')}\n\nОфициальная инструкция: ${info.docs}\n\nПароли, cookies и секрет приложения в Telegram не отправляйте.`;
}
