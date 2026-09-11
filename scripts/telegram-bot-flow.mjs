import { extractMessageUrls } from './telegram-bot-lib.mjs';
import { channelSyncHelp } from '../lib/channel-sync-help.mjs';

const keyboard = (rows) => ({ reply_markup: { inline_keyboard: rows } });
export const homeMenu = keyboard([[{ text: '⌂ Главное меню', callback_data: 'menu:home' }]]);
const invitationHelp = keyboard([[{ text: 'Как получить приглашение', callback_data: 'menu:invite-help' }], [{ text: '← Выбрать роль', callback_data: 'menu:roles' }]]);
const roles = keyboard([[{ text: 'Я продюсер', callback_data: 'role:producer' }, { text: 'Я креатор', callback_data: 'role:creator' }]]);
const types = keyboard([[{ text: 'ИИ-контент', callback_data: 'type:AI' }, { text: 'UGC — контент с людьми', callback_data: 'type:UGC' }], [{ text: '← Выбрать роль', callback_data: 'menu:roles' }]]);
const producerMenu = keyboard([
  [{ text: '＋ Добавить креатора', callback_data: 'invite:new' }],
  [{ text: 'Мои креаторы', callback_data: 'menu:creators' }, { text: 'Каналы и статистика', callback_data: 'menu:channels' }],
  [{ text: 'Профиль', callback_data: 'menu:profile' }],
]);
const creatorMenu = keyboard([[{ text: '＋ Добавить канал', callback_data: 'menu:add-channel' }], [{ text: 'Мои каналы', callback_data: 'menu:channels' }, { text: 'Профиль', callback_data: 'menu:profile' }]]);

export function telegramContact(id, username) {
  return username ? `@${username.replace(/^@/, '')}` : id ? `Telegram ID ${id}` : 'не привязан';
}

function identity(user, chatId) {
  return { telegramUserId: String(user.id), chatId: String(chatId), username: user.username ?? null,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || null };
}

export function createTelegramBotFlow({ backend, send: deliver, answerCallback, processLink, botUsername }) {
  const send = (chatId, text, extra = homeMenu) => deliver(chatId, text, extra);
  async function showContext(chatId, context) {
    if (context.ownInvite) return send(chatId, 'Это приглашение для вашего креатора. Отправьте ему ссылку — свою роль менять не нужно.');
    if (!context.role) return send(chatId, 'Добро пожаловать в «Контент-завод». Выберите свою роль:', roles);
    if (context.role === 'producer') {
      if (context.producer?.status !== 'active') return send(chatId, 'Продюсерский профиль отключён. Обратитесь к администратору.');
      return send(chatId, `Вы — продюсер: ${context.producer.name}\n\nНажмите «Добавить креатора» и отправьте ему персональную ссылку. Он подтвердит тип контента и добавит свои каналы.`, producerMenu);
    }
    if (context.binding && (context.binding.creatorStatus !== 'active' || context.binding.producerStatus !== 'active')) {
      return send(chatId, 'Ваш профиль или продюсер отключён. Обратитесь к администратору.');
    }
    if (!context.binding && context.pendingInvite?.status && context.pendingInvite.status !== 'valid') {
      return send(chatId, 'Приглашение больше не действует. Попросите продюсера новую персональную ссылку.', invitationHelp);
    }
    if (!context.binding && !context.pendingInvite) {
      return send(chatId, 'Чтобы начать, откройте личную ссылку от своего продюсера. После этого выберете ИИ / UGC и добавите каналы.', invitationHelp);
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
        keyboard([...page.filter((c) => !c.telegramUserId && c.status === 'active').map((c) => [{ text: `Пригласить: ${c.name}`.slice(0, 60), callback_data: `invite:${c.id}` }]), [{ text: '⌂ Главное меню', callback_data: 'menu:home' }]]));
    }
  }

  async function invite(chatId, actor, updateId, creatorId) {
    const result = await backend('invite', { ...actor, updateId, ...(creatorId ? { creatorId } : {}) });
    const link = `https://t.me/${botUsername()}?start=c_${result.invite.token}`;
    return send(chatId, `Приглашение креатора в вашу команду:\n${link}\n\nОтправьте эту персональную ссылку только нужному креатору. Она действует 7 дней и используется одним Telegram-аккаунтом. После входа креатор выберет ИИ / UGC и добавит каналы.`, producerMenu);
  }

  async function channels(chatId, actor, page = 0) {
    const result = await backend('channels', actor);
    if (!result.channels?.length) return send(chatId, 'Каналов пока нет. Креатор может прислать ссылку на канал или видео.');
    const count = result.channels.length;
    const pageCount = Math.ceil(count / 5);
    page = Math.min(page, pageCount - 1);
    for (const channel of result.channels.slice(page * 5, page * 5 + 5)) {
      const number = (value) => value === null || value === undefined ? 'недоступно' : Number(value).toLocaleString('ru-RU');
      const partial = ['totalViews', 'publicationCount', 'totalLikes'].some((key) => channel[key] === null || channel[key] === undefined);
      const status = { pending: 'ожидает проверки', success: partial ? 'обновлено частично' : 'обновлено', needs_auth: 'сбор ограничен доступом площадки', error: 'ошибка, повторим автоматически' }[channel.syncStatus] ?? channel.syncStatus;
      const help = channelSyncHelp(channel.platformName, channel.syncStatus);
      const updated = channel.metricsUpdatedAt ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date(channel.metricsUpdatedAt)) : 'ещё нет';
      await send(chatId, `${channel.title || channel.platformName}\n${channel.url}\nКреатор: ${channel.creatorName} (${telegramContact(channel.creatorTelegramId, channel.creatorTelegramUsername)})\nПродюсер: ${channel.producerName} (${telegramContact(channel.producerTelegramId, channel.producerTelegramUsername)})\nТип: ${channel.creatorType}\n\nПросмотры: ${number(channel.totalViews)}\nРолики: ${number(channel.publicationCount)}\nЛайки: ${number(channel.totalLikes)}\nСтатус: ${status}\nОбновлено: ${updated} (МСК)${help ? `\n\n${help}` : ''}`, { reply_markup: { inline_keyboard: [] } });
    }
    const buttons = [];
    if (page > 0) buttons.push({ text: '← Назад', callback_data: `channels:${page - 1}` });
    if (page + 1 < pageCount) buttons.push({ text: 'Далее →', callback_data: `channels:${page + 1}` });
    await send(chatId, `Страница ${page + 1} из ${pageCount}.${count === 50 ? ' Первые 50 каналов; полный список — в платформе.' : ''}\nНедоступно — площадка пока не передала показатель, это не ноль.`, keyboard([...(buttons.length ? [buttons] : []), [{ text: '⌂ Главное меню', callback_data: 'menu:home' }]]));
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
    if (context.role === 'producer' && extractMessageUrls(message).length) return send(message.chat.id, 'Каналы добавляет сам креатор из своего Telegram. Нажмите «Добавить креатора» и отправьте ему приглашение.', producerMenu);
    if (!context.canSubmit) return showContext(message.chat.id, context);
    const urls = extractMessageUrls(message);
    if (urls.length > 1) return send(message.chat.id, 'Отправьте каждую ссылку отдельным сообщением — так я проверю все каналы. Из этого сообщения пока ничего не добавлено.', creatorMenu);
    const url = urls[0];
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
    if (data === 'menu:home') return showContext(message.chat.id, await backend('context', actor));
    if (data === 'menu:roles') return send(message.chat.id, 'Выберите свою роль:', roles);
    if (data === 'menu:invite-help') return send(message.chat.id, 'Попросите продюсера открыть этого бота → «Я продюсер» → «Добавить креатора» и отправить вам полученную персональную ссылку.', invitationHelp);
    if (data === 'menu:add-channel') {
      const context = await backend('context', actor);
      return context.canSubmit ? send(message.chat.id, 'Пришлите ссылку на свой канал или видео. По одной ссылке в сообщении. Метрики соберутся автоматически.', creatorMenu) : showContext(message.chat.id, context);
    }
    const channelPage = data.match(/^channels:(\d{1,2})$/);
    if (channelPage) return channels(message.chat.id, actor, Number(channelPage[1]));
    const role = data.match(/^role:(producer|creator)$/);
    if (role) {
      const context = await backend('context', actor);
      if (context.role === role[1]) return showContext(message.chat.id, context);
      if (context.role) return send(message.chat.id, `Переключиться в режим ${role[1] === 'producer' ? 'продюсера? Если у вас ещё нет команды, будет создана новая, пустая' : 'креатора? Ваш продюсерский профиль сохранится'}.`, keyboard([
        [{ text: 'Да, переключиться', callback_data: `confirm-role:${role[1]}` }], [{ text: 'Отмена', callback_data: 'menu:home' }],
      ]));
      return showContext(message.chat.id, await backend('role', { ...actor, role: role[1] }));
    }
    const confirmedRole = data.match(/^confirm-role:(producer|creator)$/);
    if (confirmedRole) return showContext(message.chat.id, await backend('role', { ...actor, role: confirmedRole[1] }));
    const type = data.match(/^type:(AI|UGC)$/);
    if (type) {
      const context = await backend('context', actor);
      if (context.role !== 'creator' || context.selectedType || context.binding?.typeConfirmedAt
        || (!context.binding && context.pendingInvite?.status !== 'valid')) return showContext(message.chat.id, context);
      return showContext(message.chat.id, await backend('selectType', { ...actor, type: type[1] }));
    }
    const invitation = data.match(/^invite:(new|[1-9]\d*)$/);
    if (invitation) return invite(message.chat.id, actor, update.update_id, invitation[1] === 'new' ? undefined : Number(invitation[1]));
    if (data === 'menu:creators') return showCreators(message.chat.id, actor);
    if (data === 'menu:channels') return channels(message.chat.id, actor);
    if (data === 'menu:profile') return showContext(message.chat.id, await backend('context', actor));
    return send(message.chat.id, 'Эта кнопка устарела. Нажмите /start.');
  }

  return { handleMessage, handleCallback };
}
