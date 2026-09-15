import { extractMessageUrls } from './telegram-bot-lib.mjs';
import { channelSyncHelp, channelCoverage } from '../lib/channel-sync-help.mjs';
import { invitationFromMessage } from './telegram-invitation.mjs';
import { randomBytes } from 'node:crypto';
import { socialInstructionText, socialInstructions } from '../lib/social-instructions.mjs';

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
const creatorMenu = keyboard([[{ text: '＋ Добавить канал', callback_data: 'menu:add-channel' }], [{ text: 'Мои каналы', callback_data: 'menu:channels' }, { text: 'Профиль', callback_data: 'menu:profile' }], [{ text: 'Подключение соцсетей · инструкции', callback_data: 'menu:social' }]]);

export function telegramContact(id, username) {
  return username ? `@${username.replace(/^@/, '')}` : id ? `Telegram ID ${id}` : 'не привязан';
}

function identity(user, chatId) {
  return { telegramUserId: String(user.id), chatId: String(chatId), username: user.username ?? null,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || null };
}

export function createTelegramBotFlow({ backend, send: deliver, answerCallback, processLink, botUsername }) {
  const send = (chatId, text, extra = homeMenu) => deliver(chatId, text, extra);
  const confirmations = new Map();
  const editingChannels = new Map();
  const expiresAt = () => Date.now() + 10 * 60_000;
  function remember(map, id, value) {
    for (const [key, item] of map) if (item.expiresAt < Date.now()) map.delete(key);
    if (map.size >= 1000) map.delete(map.keys().next().value);
    map.set(id, { ...value, expiresAt: expiresAt() });
  }
  function socialMenu(chatId) {
    return send(chatId, 'Выберите площадку: покажу, нужен ли ключ, где его получить и как подключить свой канал. Если приложения ещё нет, сначала потребуется настройка администратором.', keyboard([...Object.keys(socialInstructions).map((name) => [{ text: name, callback_data: `social:help:${name}` }]), ...homeMenu.reply_markup.inline_keyboard]));
  }
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
      return send(chatId, 'Шаг 1 из 3 — приглашение.\n\nБот открыт, но приглашение в команду ещё не получено. Откройте личную ссылку от своего продюсера или скопируйте её целиком и отправьте сюда. После этого выберете ИИ / UGC и добавите каналы.\n\nПовторно выбирать роль не нужно.', invitationHelp);
    }
    if (!context.selectedType && !context.binding?.typeConfirmedAt) {
      return send(chatId, `${context.pendingInvite ? `Приглашение от продюсера: ${context.pendingInvite.producerName}\n\n` : ''}Перед добавлением каналов выберите тип контента. Он задаётся один раз для креатора и всех его каналов.`, types);
    }
    if (!context.binding) {
      return send(chatId, `Тип: ${context.selectedType === 'AI' ? 'ИИ-контент' : 'UGC'}.\n\nПриглашение сохранено. Нажмите «Продолжить подключение», чтобы завершить привязку.`, keyboard([[{ text: 'Продолжить подключение', callback_data: 'onboarding:resume' }]]));
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
      const partial = Boolean(channelCoverage(channel.parserSource)) || ['totalViews', 'publicationCount', 'totalLikes'].some((key) => channel[key] === null || channel[key] === undefined);
      const status = { pending: 'ожидает проверки', success: partial ? 'обновлено частично' : 'обновлено', needs_auth: 'сбор ограничен доступом площадки', error: 'ошибка, повторим автоматически' }[channel.syncStatus] ?? channel.syncStatus;
      const help = [channelSyncHelp(channel.platformName, channel.syncStatus), channelCoverage(channel.parserSource), channel.connectionStatus ? `API-доступ: ${channel.connectionStatus === 'needs_auth' ? 'требуется переподключение' : 'подключён'} · ${channel.connectionUsername || ''}${channel.connectionExpiresAt ? `\nСрок: ${new Date(channel.connectionExpiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)` : '\nСрок не подтверждён API'}` : null].filter(Boolean).join('\n\n');
      const controls = String(channel.creatorTelegramId) === actor.telegramUserId ? [
        [{ text: 'Инструкция площадки', callback_data: `social:help:${channel.platformName}` }],
        ...(channel.platformName !== 'RuTube' ? [[{ text: channel.connectionStatus ? 'Переподключить API' : 'Подключить API', callback_data: `social:connect:${channel.id}` }, ...(channel.connectionStatus ? [{ text: 'Отключить доступ', callback_data: `social:disconnect:${channel.id}` }] : [])]] : []),
        [{ text: 'Изменить ссылку', callback_data: `channel:edit:${channel.id}` }, { text: 'Удалить', callback_data: `channel:delete:${channel.id}` }],
        [{ text: channel.status === 'inactive' ? 'Возобновить сбор' : 'Приостановить сбор', callback_data: `channel:${channel.status === 'inactive' ? 'resume' : 'pause'}:${channel.id}` }],
      ] : [];
      const updated = channel.metricsUpdatedAt ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date(channel.metricsUpdatedAt)) : 'ещё нет';
      await send(chatId, `${channel.title || channel.platformName}\n${channel.url}\nКреатор: ${channel.creatorName} (${telegramContact(channel.creatorTelegramId, channel.creatorTelegramUsername)})\nПродюсер: ${channel.producerName} (${telegramContact(channel.producerTelegramId, channel.producerTelegramUsername)})\nТип: ${channel.creatorType}\n\nПросмотры: ${number(channel.totalViews)}\nРолики: ${number(channel.publicationCount)}\nЛайки: ${number(channel.totalLikes)}\nСтатус: ${channel.status === 'inactive' ? 'сбор приостановлен' : status}\nОбновлено: ${updated} (МСК)${help ? `\n\n${help}` : ''}`, { reply_markup: { inline_keyboard: controls } });
    }
    const buttons = [];
    if (page > 0) buttons.push({ text: '← Назад', callback_data: `channels:${page - 1}` });
    if (page + 1 < pageCount) buttons.push({ text: 'Далее →', callback_data: `channels:${page + 1}` });
    await send(chatId, `Страница ${page + 1} из ${pageCount}.${count === 50 ? ' Первые 50 каналов; полный список — в платформе.' : ''}\nНедоступно — площадка пока не передала показатель, это не ноль.`, keyboard([...(buttons.length ? [buttons] : []), [{ text: '⌂ Главное меню', callback_data: 'menu:home' }]]));
  }

  async function handleCommand(message, command, payload, updateId) {
    const actor = identity(message.from, message.chat.id);
    const chatId = message.chat.id;
    if (command === 'social') return socialMenu(chatId);
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
    confirmations.delete(String(message.from.id));
    const invitation = invitationFromMessage(message, botUsername());
    if (invitation) {
      editingChannels.delete(String(message.from.id));
      if (invitation.kind !== 'invite') return send(message.chat.id, invitation.kind === 'multiple'
        ? 'В сообщении несколько приглашений. Отправьте только личную ссылку от своего продюсера.'
        : 'В этой ссылке нет действительного приглашения в команду. Попросите продюсера нажать «Добавить креатора» и отправить вам полученную персональную ссылку целиком.', invitationHelp);
      try { return await showContext(message.chat.id, await backend('acceptInvite', { ...identity(message.from, message.chat.id), token: invitation.token })); }
      catch (error) {
        if (![400, 403, 404, 409, 410].includes(error.status)) throw error;
        return send(message.chat.id, `${error.message}\n\nНажмите «Как получить приглашение» или вернитесь в главное меню. Ваши существующие каналы не изменены.`, keyboard([...invitationHelp.reply_markup.inline_keyboard, ...homeMenu.reply_markup.inline_keyboard]));
      }
    }
    const command = text.match(/^\/(start|help|profile|whoami|change|role|creators|invite|channels|cancel|social)(?:@\w+)?(?:\s+(\S+))?\s*$/i);
    if (command) {
      editingChannels.delete(String(message.from.id));
      return handleCommand(message, command[1].toLowerCase(), command[2] || '', update.update_id);
    }
    if (text.startsWith('/')) return send(message.chat.id, 'Неизвестная команда. Нажмите /help.');
    const actor = identity(message.from, message.chat.id);
    const context = await backend('context', actor);
    if (context.role === 'producer' && extractMessageUrls(message).length) return send(message.chat.id, 'Каналы добавляет сам креатор из своего Telegram. Нажмите «Добавить креатора» и отправьте ему приглашение.', producerMenu);
    if (!context.canSubmit) return showContext(message.chat.id, context);
    const urls = extractMessageUrls(message);
    const edit = editingChannels.get(actor.telegramUserId);
    if (edit) {
      if (edit.expiresAt < Date.now()) {
        editingChannels.delete(actor.telegramUserId);
        return send(message.chat.id, 'Время редактирования истекло. Ничего не изменено. Откройте /channels и нажмите «Изменить ссылку» заново.');
      }
      if (urls.length !== 1) return send(message.chat.id, 'Пришлите одну новую ссылку именно на канал. /cancel — отменить редактирование.');
      await backend('updateChannel', { ...actor, id: edit.id, url: urls[0] });
      editingChannels.delete(actor.telegramUserId);
      return send(message.chat.id, 'Ссылка изменена. Статистику нового адреса соберём заново; старые показатели к нему не переносятся.', keyboard([[{ text: 'Мои каналы', callback_data: 'menu:channels' }], ...homeMenu.reply_markup.inline_keyboard]));
    }
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
    const confirmation = confirmations.get(actor.telegramUserId);
    confirmations.delete(actor.telegramUserId);
    editingChannels.delete(actor.telegramUserId);
    if (data === 'menu:social') return socialMenu(message.chat.id);
    const socialHelp = data.match(/^social:help:(Instagram|TikTok|VK|YouTube|RuTube)$/);
    if (socialHelp) return send(message.chat.id, socialInstructionText(socialHelp[1]), keyboard([[{ text: 'Мои каналы → подключить', callback_data: 'menu:channels' }], [{ text: 'Другие площадки', callback_data: 'menu:social' }], ...homeMenu.reply_markup.inline_keyboard]));
    const social = data.match(/^social:(connect|disconnect|confirm-disconnect):([1-9]\d*)(?::([a-f0-9]{16}))?$/);
    if (social) {
      const id = Number(social[2]);
      if (social[1] === 'connect') {
        const result = await backend('connectSocial', { ...actor, id });
        return send(message.chat.id, `Подключение ${result.connection.platformName}.\n\nОткройте персональную форму и нажмите «Войти через соцсеть». Если администратор ещё не включил вход, форма подскажет, что сделать. YouTube можно подключить общим или личным ключом.\n\nСсылка одноразовая, на 10 минут. Эта новая ссылка заменяет предыдущую для канала. Завершите вход в том же браузере. Не пересылайте ссылку; пароли и токены в сообщения не отправляйте.`, keyboard([[{ text: 'Открыть защищённую форму', url: result.connection.url }], [{ text: 'Мои каналы', callback_data: 'menu:channels' }]]));
      }
      if (social[1] === 'confirm-disconnect') {
        if (!confirmation || confirmation.action !== 'disconnect' || confirmation.id !== id || confirmation.nonce !== social[3] || confirmation.expiresAt < Date.now()) return send(message.chat.id, 'Это старое подтверждение. Доступ не изменён. Откройте /channels.');
        await backend('disconnectSocial', { ...actor, id });
        return send(message.chat.id, 'Сохранённый API-доступ удалён из платформы. Канал и статистика остались. Само разрешение приложения можно отозвать в настройках соцсети.');
      }
      const result = await backend('channels', actor);
      const channel = result.channels?.find((c) => c.id === id && String(c.creatorTelegramId) === actor.telegramUserId);
      if (!channel) return send(message.chat.id, 'Канал недоступен.');
      const nonce = randomBytes(8).toString('hex');
      remember(confirmations, actor.telegramUserId, { action: 'disconnect', id, nonce });
      return send(message.chat.id, `Удалить сохранённый доступ к ${channel.url}? Статистика останется, но сбор закрытых данных остановится.`, keyboard([[{ text: 'Да, отключить API', callback_data: `social:confirm-disconnect:${id}:${nonce}` }], ...homeMenu.reply_markup.inline_keyboard]));
    }
    const channelAction = data.match(/^channel:(edit|delete|pause|resume|delete-confirm):([1-9]\d*)(?::([a-f0-9]{16}))?$/);
    if (channelAction) {
      const id = Number(channelAction[2]);
      if (channelAction[1] === 'delete-confirm') {
        if (!confirmation || confirmation.action !== 'delete' || confirmation.id !== id || confirmation.nonce !== channelAction[3] || confirmation.expiresAt < Date.now()) {
          return send(message.chat.id, 'Это старое подтверждение. Каналы не изменены. Откройте /channels.');
        }
        await backend('deleteChannel', { ...actor, id });
        return send(message.chat.id, 'Канал удалён из списка, сбор остановлен. При необходимости ссылку можно добавить снова.', keyboard([[{ text: 'Мои каналы', callback_data: 'menu:channels' }], ...homeMenu.reply_markup.inline_keyboard]));
      }
      const result = await backend('channels', actor);
      const channel = result.channels?.find((c) => c.id === id && String(c.creatorTelegramId) === actor.telegramUserId);
      if (!channel) return send(message.chat.id, 'Канал уже удалён или недоступен для редактирования. Откройте /channels.');
      if (channelAction[1] === 'edit') {
        remember(editingChannels, actor.telegramUserId, { id });
        return send(message.chat.id, `Редактируем:\n${channel.url}\n\nПришлите новую ссылку на канал. После замены сбор начнётся заново; старые показатели не переносятся. /cancel — отмена.`);
      }
      if (channelAction[1] === 'delete') {
        const nonce = randomBytes(8).toString('hex');
        remember(confirmations, actor.telegramUserId, { action: 'delete', id, nonce });
        return send(message.chat.id, `Удалить этот канал?\n${channel.url}\n\nОн исчезнет из списка и выгрузок, ежедневный сбор остановится. Профиль креатора и остальные каналы останутся.`, keyboard([
          [{ text: 'Да, удалить канал', callback_data: `channel:delete-confirm:${id}:${nonce}` }], [{ text: 'Отмена', callback_data: 'menu:channels' }],
        ]));
      }
      await backend('updateChannel', { ...actor, id, status: channelAction[1] === 'pause' ? 'inactive' : 'active' });
      return channels(message.chat.id, actor);
    }
    if (data === 'menu:home') return showContext(message.chat.id, await backend('context', actor));
    if (data === 'menu:roles') return send(message.chat.id, 'Выберите свою роль:', roles);
    if (data === 'menu:invite-help') return send(message.chat.id, 'Попросите продюсера открыть этого бота → «Я продюсер» → «Добавить креатора» и отправить вам полученную персональную ссылку.\n\nОткройте её и нажмите «Запустить», если Telegram предложит. Или просто скопируйте ссылку целиком и отправьте сюда. Обычная ссылка на бота без приглашения не подключает к команде.', invitationHelp);
    if (data === 'onboarding:resume') {
      const context = await backend('context', actor);
      return showContext(message.chat.id, !context.binding && context.role === 'creator' && context.selectedType && context.pendingInvite?.status === 'valid'
        ? await backend('selectType', { ...actor, type: context.selectedType }) : context);
    }
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
      if (context.role) {
        const nonce = randomBytes(8).toString('hex');
        remember(confirmations, actor.telegramUserId, { role: role[1], nonce });
        return send(message.chat.id, `Переключиться в режим ${role[1] === 'producer' ? 'продюсера? Если у вас ещё нет команды, будет создана новая, пустая' : 'креатора? Ваш продюсерский профиль сохранится'}.`, keyboard([
          [{ text: 'Да, переключиться', callback_data: `confirm-role:${role[1]}:${nonce}` }], [{ text: 'Отмена', callback_data: 'menu:home' }],
        ]));
      }
      return showContext(message.chat.id, await backend('role', { ...actor, role: role[1] }));
    }
    const confirmedRole = data.match(/^confirm-role:(producer|creator)(?::([a-f0-9]{16}))?$/);
    if (confirmedRole) {
      const context = await backend('context', actor);
      if (context.role === confirmedRole[1]) return showContext(message.chat.id, context);
      if (!confirmation || confirmation.role !== confirmedRole[1] || confirmation.nonce !== confirmedRole[2] || confirmation.expiresAt < Date.now()) {
        return send(message.chat.id, 'Это старое подтверждение. Роль не изменена. Для переключения нажмите /role.');
      }
      return showContext(message.chat.id, await backend('role', { ...actor, role: confirmedRole[1] }));
    }
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
