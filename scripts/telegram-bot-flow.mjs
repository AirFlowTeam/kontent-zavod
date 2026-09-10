import { extractMessageUrl } from './telegram-bot-lib.mjs';

const keyboard = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const roles = keyboard([[{ text: 'Я продюсер', callback_data: 'role:producer' }, { text: 'Я креатор', callback_data: 'role:creator' }]]);
const types = keyboard([[{ text: 'ИИ-контент', callback_data: 'type:AI' }, { text: 'UGC', callback_data: 'type:UGC' }]]);
const producerMenu = keyboard([
  [{ text: '＋ Добавить креатора', callback_data: 'invite:new' }],
  [{ text: 'Мои креаторы', callback_data: 'menu:creators' }, { text: 'Каналы и статистика', callback_data: 'menu:channels' }],
  [{ text: 'Профиль', callback_data: 'menu:profile' }],
]);
const creatorMenu = keyboard([[{ text: 'Мои каналы', callback_data: 'menu:channels' }, { text: 'Профиль', callback_data: 'menu:profile' }]]);

export function telegramContact(id, username) {
  return username ? `@${username.replace(/^@/, '')}` : id ? `Telegram ID ${id}` : 'не привязан';
}

function identity(user, chatId) {
  return { telegramUserId: String(user.id), chatId: String(chatId), username: user.username ?? null,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || null };
}

export function createTelegramBotFlow({ backend, send, answerCallback, processLink, botUsername }) {
  async function showContext(chatId, context) {
    if (!context.role) return send(chatId, 'Добро пожаловать в «Контент-завод». Выберите свою роль:', roles);
    if (context.role === 'producer') {
      if (context.producer?.status !== 'active') return send(chatId, 'Продюсерский профиль отключён. Обратитесь к администратору.');
      return send(chatId, `Вы — продюсер: ${context.producer.name}\n\nНажмите «Добавить креатора» и отправьте ему персональную ссылку. Он подтвердит тип контента и добавит свои каналы.`, producerMenu);
    }
    if (context.binding && (context.binding.creatorStatus !== 'active' || context.binding.producerStatus !== 'active')) {
      return send(chatId, 'Ваш профиль или продюсер отключён. Обратитесь к администратору.');
    }
    if (!context.selectedType && !context.binding?.typeConfirmedAt) {
      return send(chatId, `${context.pendingInvite ? `Приглашение от продюсера: ${context.pendingInvite.producerName}\n\n` : ''}Перед добавлением каналов выберите тип контента. Он задаётся один раз для креатора и всех его каналов.`, types);
    }
    if (!context.binding) {
      return send(chatId, `Тип: ${context.selectedType === 'AI' ? 'ИИ-контент' : 'UGC'}.\n\nТеперь откройте персональную пригласительную ссылку своего продюсера. После привязки сможете добавлять каналы.`);
    }
    if (!context.canSubmit) return send(chatId, 'Для каналов нужна Telegram-привязка вашего продюсера. Попросите администратора связать существующий профиль продюсера с его Telegram.');
    return send(chatId, `Креатор: ${context.binding.name}\nТип: ${context.binding.type === 'AI' ? 'ИИ-контент' : 'UGC'}\nПродюсер: ${context.binding.producerName} (${telegramContact(context.binding.producerTelegramId, context.binding.producerTelegramUsername)})\n\nПришлите ссылку на свой канал или видео. Бот определит канал; отдельные ролики не сохраняются. Первая проверка — сразу, затем раз в сутки.`, creatorMenu);
  }

  async function showCreators(chatId, actor) {
    const context = await backend('context', actor);
    if (context.role !== 'producer' || context.producer?.status !== 'active') return showContext(chatId, context);
    if (!context.creators?.length) return send(chatId, 'Креаторов пока нет. Создайте приглашение и отправьте его креатору.', producerMenu);
    for (let i = 0; i < context.creators.length; i += 10) {
      const page = context.creators.slice(i, i + 10);
      await send(chatId, page.map((c) => `${c.name} · ${c.type}\n${telegramContact(c.telegramUserId, c.telegramUsername)} · каналов: ${c.channelCount} · ${c.status === 'active' ? 'активен' : 'отключён'}`).join('\n\n'),
        keyboard(page.filter((c) => !c.telegramUserId && c.status === 'active').map((c) => [{ text: `Пригласить: ${c.name}`.slice(0, 60), callback_data: `invite:${c.id}` }])));
    }
  }

  async function invite(chatId, actor, updateId, creatorId) {
    const result = await backend('invite', { ...actor, updateId, ...(creatorId ? { creatorId } : {}) });
    const link = `https://t.me/${botUsername()}?start=c_${result.invite.token}`;
    return send(chatId, `Приглашение креатора в вашу команду:\n${link}\n\nОтправьте эту персональную ссылку только нужному креатору. Она действует 7 дней и используется одним Telegram-аккаунтом. После входа креатор выберет ИИ / UGC и добавит каналы.`, producerMenu);
  }

  async function channels(chatId, actor) {
    const result = await backend('channels', actor);
    if (!result.channels?.length) return send(chatId, 'Каналов пока нет. Креатор может прислать ссылку на канал или видео.');
    for (const channel of result.channels) {
      const number = (value) => value === null || value === undefined ? 'недоступно' : Number(value).toLocaleString('ru-RU');
      const status = { pending: 'ожидает проверки', success: 'обновлено', needs_auth: 'нужна авторизация площадки', error: 'ошибка, повторим автоматически' }[channel.syncStatus] ?? channel.syncStatus;
      await send(chatId, `${channel.title || channel.platformName}\n${channel.url}\nКреатор: ${channel.creatorName} (${telegramContact(channel.creatorTelegramId, channel.creatorTelegramUsername)})\nПродюсер: ${channel.producerName} (${telegramContact(channel.producerTelegramId, channel.producerTelegramUsername)})\nТип: ${channel.creatorType}\n\nПодписчики: ${number(channel.followers)}\nПросмотры канала: ${number(channel.totalViews)}\nПубликации: ${number(channel.publicationCount)}\nСтатус: ${status}\nПоследние данные: ${channel.metricsUpdatedAt || 'пока нет'}\nСледующая попытка: ${channel.nextSyncAt || 'не запланирована'}`);
    }
    if (result.channels.length === 50) await send(chatId, 'Показаны первые 50 каналов. Полный список — в платформе.');
  }

  async function handleCommand(message, command, payload, updateId) {
    const actor = identity(message.from, message.chat.id);
    const chatId = message.chat.id;
    if (command === 'help') return send(chatId,
      'Продюсер: /start → «Я продюсер» → «Добавить креатора» → передать ему персональное приглашение.\n\nКреатор: открыть приглашение → выбрать ИИ-контент или UGC → прислать ссылки на свои каналы или видео.\n\nСтатистика обновляется раз в сутки. /channels — каналы, показатели и статусы. /creators — команда продюсера. /profile — профиль. /role — переключить свою роль.\n\nПоддерживаются YouTube, RuTube, VK, TikTok, Instagram. Закрытые данные требуют доступа площадки; недоступные показатели не заменяются нулями.');
    if (command === 'role' || command === 'change') return send(chatId, 'Выберите свою роль. Чужие профили недоступны:', roles);
    if (command === 'creators') return showCreators(chatId, actor);
    if (command === 'invite') return invite(chatId, actor, updateId);
    if (command === 'channels') return channels(chatId, actor);
    if (command === 'start' && payload.startsWith('c_')) return showContext(chatId, await backend('acceptInvite', { ...actor, token: payload.slice(2) }));
    return showContext(chatId, await backend('context', actor));
  }

  async function handleMessage(update) {
    const message = update.message;
    if (!message?.from || message.chat?.type !== 'private' || String(message.from.id) !== String(message.chat.id)) return;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const command = text.match(/^\/(start|help|profile|whoami|change|role|creators|invite|channels)(?:@\w+)?(?:\s+(\S+))?\s*$/i);
    if (command) return handleCommand(message, command[1].toLowerCase(), command[2] || '', update.update_id);
    if (text.startsWith('/')) return send(message.chat.id, 'Неизвестная команда. Нажмите /help.');
    const actor = identity(message.from, message.chat.id);
    const context = await backend('context', actor);
    if (!context.canSubmit) return showContext(message.chat.id, context);
    const url = extractMessageUrl(message);
    if (!url) return send(message.chat.id, 'Пришлите ссылку на свой канал или видео, начиная с https://. /channels — ваши каналы.');
    return processLink(message.chat.id, message.from, update.update_id, url);
  }

  async function handleCallback(update) {
    const callback = update.callback_query;
    if (!callback?.id) return;
    await answerCallback(callback.id);
    const message = callback.message;
    if (!callback.from || message?.chat?.type !== 'private' || String(message.chat.id) !== String(callback.from.id)) return;
    const actor = identity(callback.from, message.chat.id);
    const data = String(callback.data || '');
    const role = data.match(/^role:(producer|creator)$/);
    if (role) return showContext(message.chat.id, await backend('role', { ...actor, role: role[1] }));
    const type = data.match(/^type:(AI|UGC)$/);
    if (type) return showContext(message.chat.id, await backend('selectType', { ...actor, type: type[1] }));
    const invitation = data.match(/^invite:(new|[1-9]\d*)$/);
    if (invitation) return invite(message.chat.id, actor, update.update_id, invitation[1] === 'new' ? undefined : Number(invitation[1]));
    if (data === 'menu:creators') return showCreators(message.chat.id, actor);
    if (data === 'menu:channels') return channels(message.chat.id, actor);
    if (data === 'menu:profile') return showContext(message.chat.id, await backend('context', actor));
    return send(message.chat.id, 'Эта кнопка устарела. Нажмите /start.');
  }

  return { handleMessage, handleCallback };
}
