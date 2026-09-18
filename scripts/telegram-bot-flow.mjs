import { extractMessageUrls } from './telegram-bot-lib.mjs';
import { channelCoverage } from '../lib/channel-sync-help.mjs';
import { invitationFromMessage } from './telegram-invitation.mjs';
import { randomBytes } from 'node:crypto';
import { socialInstructions } from '../lib/social-instructions.mjs';
import { channelInstructions, MAX_LINKS_PER_MESSAGE } from '../lib/channel-instructions.mjs';
import { createTelegramAdminFlow } from './telegram-admin-flow.mjs';
import { channelJourney } from '../lib/social-journey.mjs';
import { containsGoogleApiKey } from './telegram-google-key.mjs';
import { telegramYouTubeError } from './telegram-youtube-error.mjs';

const keyboard = (rows) => ({ reply_markup: { inline_keyboard: rows } });
export const homeMenu = keyboard([[{ text: '⌂ Главное меню', callback_data: 'menu:home' }]]);
const invitationHelp = keyboard([[{ text: 'Как получить приглашение', callback_data: 'menu:invite-help' }], [{ text: '← Выбрать роль', callback_data: 'menu:roles' }]]);
const roles = keyboard([[{ text: 'Я продюсер', callback_data: 'role:producer' }, { text: 'Я креатор', callback_data: 'role:creator' }]]);
const types = keyboard([[{ text: 'ИИ', callback_data: 'type:AI' }, { text: 'UGC', callback_data: 'type:UGC' }]]);
const producerMenu = keyboard([[{ text: 'Пригласить креатора', callback_data: 'invite:new' }], [{ text: 'Креаторы и каналы', callback_data: 'menu:creators' }], [{ text: 'Назад', callback_data: 'menu:home' }]]);
const creatorMenu = keyboard([[{ text: 'Добавить канал', callback_data: 'menu:add-channel' }], [{ text: 'Мои каналы', callback_data: 'menu:channels' }]]);
const platformsKeyboard = () => keyboard([
  ...['YouTube', 'RuTube', 'VK', 'Instagram', 'Threads', 'TikTok'].map((name) => [{ text: name, callback_data: `guide:link:${name}:0` }]),
  [{ text: 'Назад', callback_data: 'menu:home' }],
]);

export function telegramContact(id, username) {
  return username ? `@${username.replace(/^@/, '')}` : id ? `Telegram ID ${id}` : 'не привязан';
}

function identity(user, chatId) {
  return { telegramUserId: String(user.id), chatId: String(chatId), username: user.username ?? null,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(' ') || null };
}

export function createTelegramBotFlow({ backend, send: deliver, sendGuide, answerCallback, processLink, botUsername }) {
  const send = (chatId, text, extra = homeMenu) => deliver(chatId, text, extra);
  const adminFlow = createTelegramAdminFlow({ backend, send, botUsername, showPersonal: showContext });
  const confirmations = new Map();
  const editingChannels = new Map();
  const expiresAt = () => Date.now() + 10 * 60_000;
  function remember(map, id, value) {
    for (const [key, item] of map) if (item.expiresAt < Date.now()) map.delete(key);
    if (map.size >= 1000) map.delete(map.keys().next().value);
    map.set(id, { ...value, expiresAt: expiresAt() });
  }
  function socialMenu(chatId) {
    return send(chatId, 'Для какой соцсети нужна инструкция?', keyboard([
      ...Object.keys(socialInstructions).map((name) => [{ text: name, callback_data: `social:help:${name}` }]),
      [{ text: 'Назад', callback_data: 'menu:home' }],
    ]));
  }
  async function openConnection(chatId, actor, id, notice = '', knownChannel) {
    const channel = knownChannel || await ownedChannel(actor, id);
    if (!channel) return send(chatId, 'Канал недоступен.');
    if (channel.platformName === 'RuTube') return channelCard(chatId, channel, true);
    const saved = await backend('journey', actor);
    const platform = channel.platformName;
    const setup = (saved.setup || []).find((item) => item.platformName === platform);
    const intro = notice ? `${notice}\n\n` : '';
    if (setup?.available !== true) return send(chatId, `${intro}${platform} · подключение\n\n${setup?.available === false
      ? setup.reason || `Официальный вход ${platform} ещё не включён. Администратор сервиса должен завершить настройку; передайте продюсеру название площадки и ссылку на канал.`
      : 'Не удалось подтвердить готовность официального входа. Попробуйте ещё раз; если статус не изменится, передайте продюсеру название площадки и ссылку на канал.'}\n\nПовторно добавлять канал не нужно.`, keyboard([
      [{ text: 'Проверить доступность входа', callback_data: `social:connect:${id}` }],
      [{ text: 'Инструкция файлом', callback_data: `social:file:${platform}` }],
      [{ text: 'Назад к каналу', callback_data: `channel:show:${id}` }],
    ]));
    const result = await backend('connectSocial', { ...actor, id });
    if (result.connection.platformName !== platform) return send(chatId, 'Канал изменился. Откройте «Мои каналы» и выберите его заново.', creatorMenu);
    const login = platform === 'YouTube' ? 'Войти через Google' : `Войти через ${platform}`;
    const step = platform === 'YouTube'
      ? 'Войдите через Google аккаунтом владельца этого YouTube-канала и разрешите чтение данных.'
      : `Войдите в свой ${platform} и разрешите чтение статистики.`;
    return send(chatId, `${intro}${platform} · ${channel.title || channel.url}\n\n${step}\n\nПосле подтверждения вернитесь в бот и обновите результат.${channel.status === 'inactive' ? ' Затем нажмите «Возобновить сбор».' : ''} Ссылка личная, действует 10 минут.`, keyboard([
      [{ text: login, url: result.connection.url }],
      [{ text: channel.status === 'inactive' ? 'Возобновить сбор' : 'Обновить результат', callback_data: `channel:${channel.status === 'inactive' ? 'resume' : 'show'}:${id}` }],
      [{ text: 'Помощь', callback_data: `channel:help:${id}` }],
    ]));
  }
  async function youtubeKeyMenu(chatId, actor, page = 0, notice = '') {
    const context = await backend('context', actor);
    if (!context.canSubmit) {
      if (notice) await send(chatId, notice, {});
      return showContext(chatId, context);
    }
    const result = await backend('channels', { ...actor, scope: 'own' });
    const own = (result.channels || []).filter((channel) => channel.platformName === 'YouTube'
      && String(channel.creatorTelegramId) === actor.telegramUserId);
    const intro = notice ? `${notice}\n\n` : '';
    if (!own.length) return send(chatId, `${intro}Сначала пришлите ссылку на свой YouTube-канал. После добавления подключите его через Google.`, keyboard([
      [{ text: 'Как добавить YouTube', callback_data: 'guide:link:YouTube:0' }], ...homeMenu.reply_markup.inline_keyboard,
    ]));
    if (own.length === 1) return openConnection(chatId, actor, own[0].id, notice, own[0]);
    const lastPage = Math.floor((own.length - 1) / 20);
    const currentPage = Math.min(page, lastPage);
    const navigation = [];
    if (currentPage) navigation.push({ text: '← Назад', callback_data: `youtube:keys:${currentPage - 1}` });
    if (currentPage < lastPage) navigation.push({ text: 'Далее →', callback_data: `youtube:keys:${currentPage + 1}` });
    return send(chatId, `${intro}Какой свой YouTube-канал подключить через Google? Выберите канал ниже.`, keyboard([
      ...own.slice(currentPage * 20, currentPage * 20 + 20).map((channel) => [{ text: `YouTube · ${channel.title || channel.url}`.slice(0, 60), callback_data: `social:personal:${channel.id}` }]),
      ...(navigation.length ? [navigation] : []), ...homeMenu.reply_markup.inline_keyboard,
    ]));
  }
  async function connectionMenu(chatId, actor, platform) {
    const context = await backend('context', actor);
    if (!context.canSubmit) return showContext(chatId, context);
    const result = await backend('channels', { ...actor, scope: 'own' });
    const own = (result.channels || []).filter((c) => String(c.creatorTelegramId) === actor.telegramUserId && (!platform || c.platformName === platform));
    if (!own.length) return send(chatId, 'Сначала добавьте канал. Какая соцсеть?', platformsKeyboard());
    if (own.length === 1) return channelCard(chatId, own[0], true);
    return channelList(chatId, own, 0, 'own');
  }
  async function guide(chatId, actor, options = {}) {
    const context = options.context || await backend('context', actor);
    if (!context.canSubmit) return showContext(chatId, context);
    const result = await backend('channels', { ...actor, scope: 'own' });
    const own = (result.channels || []).filter((c) => String(c.creatorTelegramId) === actor.telegramUserId);
    const next = own.find((c) => !['ready', 'limited'].includes(channelJourney(c).state));
    if (next || own[0]) return channelCard(chatId, next || own[0], true);
    return home(chatId, context, own.length ? 'Все добавленные каналы проверены. Показатели и ограничения — в «Моих каналах».' : undefined);
  }
  function instruction(chatId, name, index, kind, channelId) {
    const steps = kind === 'link' ? channelInstructions[name] : socialInstructions[name]?.steps;
    if (!steps || !Number.isInteger(index) || index < 0 || index >= steps.length) return socialMenu(chatId);
    if (kind === 'link') return send(chatId, `${name}\n\n${steps.join('\n\n')}\n\nОтправьте ссылку следующим сообщением.`, keyboard([
      [{ text: 'Другая соцсеть', callback_data: 'menu:add-channel' }], [{ text: 'Назад', callback_data: 'menu:home' }],
    ]));
    const next = index + 1 < steps.length
      ? { text: 'Далее', callback_data: channelId ? `access:step:${channelId}:${index + 1}` : `social:help:${name}:${index + 1}` }
      : { text: name === 'RuTube' ? 'Проверить результат' : 'Подключить доступ', callback_data: channelId ? `${name === 'RuTube' ? 'channel:show' : 'social:connect'}:${channelId}` : `connections:${name}` };
    return send(chatId, `${name} · шаг ${index + 1} из ${steps.length}\n\n${steps[index]}`, keyboard([
      [next], [{ text: 'Инструкция файлом', callback_data: `social:file:${name}` }],
      [{ text: 'Назад к каналу', callback_data: channelId ? `channel:show:${channelId}` : `connections:${name}` }],
    ]));
  }
  function home(chatId, context, notice) {
    return send(chatId, notice || `${context.role === 'producer' ? 'Продюсер' : 'Креатор'} · ${context.binding?.type === 'AI' ? 'ИИ' : 'UGC'}\nДобавьте свой канал — помогу подключить доступ и получить статистику.`, keyboard([
      ...creatorMenu.reply_markup.inline_keyboard,
      ...(context.canProduce ? [[{ text: 'Моя команда', callback_data: 'menu:team' }]] : []),
    ]));
  }
  async function showContext(chatId, context) {
    if (context.ownInvite) return send(chatId, 'Это приглашение для другого креатора. Свой канал добавляется через главное меню.');
    if (!context.role) return send(chatId, 'Кто вы?', roles);
    if ((context.role === 'producer' && context.producer?.status === 'inactive') || (context.binding && (context.binding.creatorStatus !== 'active' || context.binding.producerStatus !== 'active'))) {
      return send(chatId, 'Профиль отключён. Обратитесь к администратору.');
    }
    if (!context.binding && context.pendingInvite?.status && context.pendingInvite.status !== 'valid') {
      return send(chatId, 'Приглашение больше не действует. Попросите продюсера новую ссылку.', invitationHelp);
    }
    if (!context.binding?.typeConfirmedAt) {
      if (context.selectedType) return send(chatId, 'Тип контента сохранён. Завершим подключение профиля.', keyboard([[{ text: 'Продолжить', callback_data: 'onboarding:resume' }]]));
      return send(chatId, `Какой контент вы создаёте?${context.pendingInvite ? `\nКоманда: ${context.pendingInvite.producerName}` : ''}\nТип выбирается один раз для ваших каналов.`, types);
    }
    if (!context.canSubmit) return send(chatId, 'Не удалось открыть личные каналы: проверьте с администратором активность профиля и Telegram-привязку.');
    return home(chatId, context);
  }

  async function showCreators(chatId, actor) {
    const context = await backend('context', actor);
    if (!(context.canProduce ?? (context.role === 'producer' && context.producer?.status === 'active'))) return showContext(chatId, context);
    if (!context.creators?.length) return send(chatId, 'Креаторов пока нет. Создайте приглашение и отправьте его креатору.', producerMenu);
    for (let i = 0; i < context.creators.length; i += 10) {
      const page = context.creators.slice(i, i + 10);
      await send(chatId, page.map((c) => `${c.name} · ${c.type}\n${telegramContact(c.telegramUserId, c.telegramUsername)} · каналов: ${c.channelCount} · ${c.status === 'active' ? 'активен' : 'отключён'}`).join('\n\n'),
        keyboard([...page.filter((c) => !c.telegramUserId && c.status === 'active').map((c) => [{ text: `Пригласить: ${c.name}`.slice(0, 60), callback_data: `invite:${c.id}` }]), [{ text: 'Каналы команды', callback_data: 'menu:team-channels' }], [{ text: 'Назад', callback_data: 'menu:team' }]]));
    }
  }

  async function invite(chatId, actor, updateId, creatorId) {
    const result = await backend('invite', { ...actor, updateId, ...(creatorId ? { creatorId } : {}) });
    const link = `https://t.me/${botUsername()}?start=c_${result.invite.token}`;
    return send(chatId, `Приглашение креатора в вашу команду:\n${link}\n\nОтправьте эту персональную ссылку только нужному креатору. Она действует 7 дней и используется одним Telegram-аккаунтом. После входа креатор выберет ИИ / UGC и добавит каналы.`, keyboard([[{ text: 'Моя команда', callback_data: 'menu:team' }], [{ text: 'Назад', callback_data: 'menu:home' }]]));
  }

  function channelCard(chatId, channel, ownChannel) {
    const state = channelJourney(channel);
    const number = (value) => value == null ? 'не получено' : Number(value).toLocaleString('ru-RU');
    const waiting = channel.syncStatus === 'pending' || channel.lastSyncStatus === 'syncing';
    const ready = ['ready', 'limited'].includes(state.state);
    const next = state.state === 'access' ? 'Войдите аккаунтом владельца. Затем проверим показатели этого канала.'
      : state.state === 'paused' ? 'Сбор приостановлен. Возобновите его для обновления статистики.'
      : waiting ? 'Проверка в очереди. Через несколько минут нажмите «Обновить результат».'
      : ready ? 'Канал проверен. Дальше обновляем ежедневно.'
      : 'Не все показатели получены. Повторите проверку или откройте помощь — там шаги подключения аккаунта.';
    const action = ready ? { text: 'Добавить ещё канал', callback_data: 'menu:add-channel' }
      : state.state === 'check' && waiting ? { text: 'Обновить результат', callback_data: `channel:show:${channel.id}` }
      : { text: state.action, callback_data: state.callback };
    const rows = ownChannel ? [[action], [{ text: 'Помощь', callback_data: `channel:help:${channel.id}` }], [{ text: 'Настройки', callback_data: `channel:settings:${channel.id}` }]]
      : [[{ text: 'Инструкция для креатора', callback_data: `social:file:${channel.platformName}` }], [{ text: 'Назад к команде', callback_data: 'menu:team-channels' }]];
    const updated = channel.metricsUpdatedAt ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date(channel.metricsUpdatedAt)) : null;
    return send(chatId, `${channel.platformName} · ${channel.title || channel.creatorName || 'канал'}\n${channel.url}\n${ownChannel ? '' : `Креатор: ${channel.creatorName} · ${telegramContact(channel.creatorTelegramId, channel.creatorTelegramUsername)}\n`}\nПросмотры: ${number(channel.totalViews)}\n${channel.platformName === 'Threads' ? 'Посты' : 'Ролики'}: ${number(channel.publicationCount)}\nЛайки: ${number(channel.totalLikes)}${updated ? `\nОбновлено: ${updated} МСК` : ''}\n\n${state.label}.\n${ownChannel ? next : 'Личный доступ подключает владелец канала в своём боте.'}${telegramYouTubeError(channel) ? `\n\n${telegramYouTubeError(channel)}` : ''}${channelCoverage(channel.parserSource) ? `\n\n${channelCoverage(channel.parserSource)}` : ''}`, keyboard(rows));
  }
  function channelList(chatId, items, page, scope) {
    const pageCount = Math.ceil(items.length / 5);
    page = Math.min(page, pageCount - 1);
    const prefix = scope === 'team' ? 'team-channels' : 'channels';
    const navigation = [];
    if (page > 0) navigation.push({ text: '←', callback_data: `${prefix}:${page - 1}` });
    if (page + 1 < pageCount) navigation.push({ text: '→', callback_data: `${prefix}:${page + 1}` });
    return send(chatId, `${scope === 'team' ? 'Каналы команды' : 'Мои каналы'} · ${items.length}\nВыберите канал${pageCount > 1 ? ` (страница ${page + 1}/${pageCount})` : ''}.`, keyboard([
      ...items.slice(page * 5, page * 5 + 5).map((c) => [{ text: `${c.platformName} · ${c.title || c.creatorName || c.url}`.slice(0, 60), callback_data: `${scope === 'team' ? 'team' : 'channel'}:show:${c.id}` }]),
      ...(navigation.length ? [navigation] : []), [{ text: 'Назад', callback_data: scope === 'team' ? 'menu:team' : 'menu:home' }],
    ]));
  }
  async function channels(chatId, actor, page = 0, scope = 'own', channelId) {
    const context = await backend('context', actor);
    if (scope !== 'team' && !context.canSubmit) return showContext(chatId, context);
    const result = await backend('channels', { ...actor, scope });
    const items = scope === 'team' ? result.channels || [] : (result.channels || []).filter((c) => String(c.creatorTelegramId) === actor.telegramUserId);
    if (!items.length) return send(chatId, scope === 'team' ? 'В команде пока нет каналов.' : 'Добавьте первый канал.', scope === 'team' ? producerMenu : creatorMenu);
    const channel = channelId ? items.find((c) => c.id === channelId) : items.length === 1 ? items[0] : null;
    if (channelId && !channel) return send(chatId, 'Канал недоступен.');
    return channel ? channelCard(chatId, channel, scope !== 'team') : channelList(chatId, items, page, scope);
  }
  async function ownedChannel(actor, id) {
    const result = await backend('channels', { ...actor, scope: 'own' });
    return result.channels?.find((c) => c.id === id && String(c.creatorTelegramId) === actor.telegramUserId);
  }

  async function handleCommand(message, command, payload, updateId) {
    const actor = identity(message.from, message.chat.id);
    const chatId = message.chat.id;
    if (command === 'social') return socialMenu(chatId);
    if (command === 'guide') return guide(chatId, actor);
    if (command === 'api') return connectionMenu(chatId, actor);
    if (command === 'help') return send(chatId, 'Выберите роль → ИИ или UGC → «Добавить канал» → соцсеть. Отправьте ссылку и выполните следующий шаг под каналом.\n\nВойдите через свою соцсеть; YouTube подключается через Google, а RuTube читается по публичной ссылке. Если данных нет, нажмите «Помощь» в карточке канала. Там пошаговая инструкция и файл.\n\n/start — главное меню. /channels — ваши каналы. После подключения обновляем статистику ежедневно.', keyboard([[{ text: 'Продолжить подключение', callback_data: 'menu:journey' }], [{ text: 'Инструкция файлом', callback_data: 'guide:file' }], [{ text: 'Главное меню', callback_data: 'menu:home' }]]));
    if (command === 'role' || command === 'change') {
      const context = await backend('context', actor);
      return context.dualRole ? showContext(chatId, context) : send(chatId, 'Выберите свою роль. Чужие профили недоступны:', roles);
    }
    if (command === 'creators') return showCreators(chatId, actor);
    if (command === 'invite') return invite(chatId, actor, updateId);
    if (command === 'channels') return channels(chatId, actor);
    if (command === 'start' && payload === 'check') return guide(chatId, actor);
    if (command === 'start' && payload.startsWith('c_')) return showContext(chatId, await backend('acceptInvite', { ...actor, token: payload.slice(2) }));
    return showContext(chatId, await backend('context', actor));
  }

  async function handleMessage(update) {
    const message = update.message;
    if (!message?.from || message.chat?.type !== 'private' || String(message.from.id) !== String(message.chat.id)) return;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    confirmations.delete(String(message.from.id));
    if (containsGoogleApiKey(message)) {
      adminFlow.cancel(message.from.id);
      editingChannels.delete(String(message.from.id));
      return youtubeKeyMenu(message.chat.id, identity(message.from, message.chat.id), 0,
        'Ключ из сообщения не подключён. Для YouTube используйте вход через Google; сообщение с ключом удалите из чата.');
    }
    const invitation = invitationFromMessage(message, botUsername());
    if (invitation) {
      adminFlow.cancel(message.from.id);
      editingChannels.delete(String(message.from.id));
      if (invitation.kind === 'check') {
        const actor = identity(message.from, message.chat.id);
        return invitation.channelId ? channels(message.chat.id, actor, 0, 'own', invitation.channelId) : guide(message.chat.id, actor);
      }
      if (invitation.kind !== 'invite') return send(message.chat.id, invitation.kind === 'multiple'
        ? 'В сообщении несколько приглашений. Отправьте только личную ссылку от своего продюсера.'
        : 'В этой ссылке нет действительного приглашения в команду. Попросите продюсера нажать «Добавить креатора» и отправить вам полученную персональную ссылку целиком.', invitationHelp);
      try { return await showContext(message.chat.id, await backend('acceptInvite', { ...identity(message.from, message.chat.id), token: invitation.token })); }
      catch (error) {
        if (![400, 403, 404, 409, 410].includes(error.status)) throw error;
        return send(message.chat.id, `${error.message}\n\nНажмите «Как получить приглашение» или вернитесь в главное меню. Ваши существующие каналы не изменены.`, keyboard([...invitationHelp.reply_markup.inline_keyboard, ...homeMenu.reply_markup.inline_keyboard]));
      }
    }
    if (text.startsWith('/')) editingChannels.delete(String(message.from.id));
    if (await adminFlow.handleMessage(message, identity(message.from, message.chat.id))) return;
    const command = text.match(/^\/(start|help|guide|api|profile|whoami|change|role|creators|invite|channels|cancel|social)(?:@\w+)?(?:\s+(\S+))?\s*$/i);
    if (command) {
      editingChannels.delete(String(message.from.id));
      return handleCommand(message, command[1].toLowerCase(), command[2] || '', update.update_id);
    }
    if (text.startsWith('/')) return send(message.chat.id, 'Неизвестная команда. Нажмите /help.');
    const actor = identity(message.from, message.chat.id);
    const context = await backend('context', actor);
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
    if (urls.length > MAX_LINKS_PER_MESSAGE) return send(message.chat.id, `В одном сообщении можно до ${MAX_LINKS_PER_MESSAGE} ссылок. Разделите список на несколько сообщений. Из этого сообщения пока ничего не добавлено.`, creatorMenu);
    if (!urls.length) return send(message.chat.id, 'Пришлите ссылку на свой канал, начиная с https://. Или нажмите «Добавить канал» — помогу найти ссылку.', creatorMenu);
    if (urls.length > 1) await send(message.chat.id, `Получено ссылок: ${urls.length}. Проверяю каждую по очереди; для ссылок на ролики это может занять несколько минут.`, {});
    let savedChannel;
    for (const [itemIndex, url] of urls.entries()) {
      try { const result = await processLink(message.chat.id, message.from, update.update_id, url, itemIndex); if (result?.channel?.creatorMatch !== false) savedChannel = result?.channel || savedChannel; }
      catch (error) {
        if (!error.userSafe || ![400, 403, 404, 409, 410, 422].includes(error.status)) throw error;
        await send(message.chat.id, `Ссылка ${itemIndex + 1} не добавлена: ${error.message}\nОстальные ссылки продолжаю проверять.`, creatorMenu);
      }
    }
    return savedChannel?.id ? channels(message.chat.id, actor, 0, 'own', savedChannel.id) : guide(message.chat.id, actor);
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
    if (await adminFlow.handleCallback(callback, actor, update.update_id)) return;
    if (data === 'menu:team') {
      const context = await backend('context', actor);
      return context.canProduce ? send(message.chat.id, 'Моя команда', producerMenu) : showContext(message.chat.id, context);
    }
    const teamShow = data.match(/^team:show:([1-9]\d*)$/);
    if (teamShow) return channels(message.chat.id, actor, 0, 'team', Number(teamShow[1]));
    const settings = data.match(/^channel:(help|settings|access|manage):([1-9]\d*)$/);
    const accessStep = data.match(/^access:step:([1-9]\d*):(\d{1,2})$/);
    if (settings || accessStep) {
      const id = Number(settings?.[2] || accessStep[1]);
      const channel = await ownedChannel(actor, id);
      if (!channel) return send(message.chat.id, 'Канал недоступен.');
      if (settings?.[1] === 'help' || accessStep) return instruction(message.chat.id, channel.platformName, Number(accessStep?.[2] || 0), 'api', id);
      const back = [{ text: 'Назад к каналу', callback_data: `channel:show:${id}` }];
      if (settings[1] === 'access') return send(message.chat.id, 'Личный доступ к этому каналу', keyboard([
        ...(channel.platformName !== 'RuTube' ? [[{ text: channel.connectionStatus ? 'Заменить доступ' : 'Подключить доступ', callback_data: `social:connect:${id}` }]] : []),
        ...(channel.connectionStatus ? [[{ text: 'Отключить доступ', callback_data: `social:disconnect:${id}` }]] : []), back,
      ]));
      if (settings[1] === 'manage') return send(message.chat.id, 'Управление каналом', keyboard([
        [{ text: 'Изменить ссылку', callback_data: `channel:edit:${id}` }],
        [{ text: channel.status === 'inactive' ? 'Возобновить сбор' : 'Приостановить сбор', callback_data: `channel:${channel.status === 'inactive' ? 'resume' : 'pause'}:${id}` }],
        [{ text: 'Удалить канал', callback_data: `channel:delete:${id}` }], back,
      ]));
      return send(message.chat.id, `${channel.platformName} · настройки`, keyboard([
        ...(channel.platformName !== 'RuTube' ? [[{ text: 'Личный доступ', callback_data: `channel:access:${id}` }]] : []),
        [{ text: 'Управление каналом', callback_data: `channel:manage:${id}` }],
        [{ text: 'Главное меню', callback_data: 'menu:home' }],
      ]));
    }
    if (data === 'menu:social') return socialMenu(message.chat.id);
    if (data === 'menu:guide' || data === 'menu:journey') return guide(message.chat.id, actor);
    if (data === 'menu:connections') return connectionMenu(message.chat.id, actor);
    const youtubeKeys = data.match(/^youtube:keys:(\d{1,6})$/);
    if (youtubeKeys) return youtubeKeyMenu(message.chat.id, actor, Number(youtubeKeys[1]));
    const guideFile = data.match(/^social:file:([A-Za-z]+)$/);
    if (data === 'guide:file' || (guideFile && Object.hasOwn(socialInstructions, guideFile[1]))) {
      if (sendGuide) return sendGuide(message.chat.id, guideFile?.[1]);
      return guideFile ? instruction(message.chat.id, guideFile[1], 0, 'api') : guide(message.chat.id, actor);
    }
    const skipPlatform = data.match(/^journey:skip:([A-Za-z]+)$/);
    if (skipPlatform && Object.hasOwn(channelInstructions, skipPlatform[1])) {
      await backend('setJourneyPlatform', { ...actor, platformName: skipPlatform[1], status: 'skipped' });
      return guide(message.chat.id, actor);
    }
    const checkChannel = data.match(/^channel:(check|show):([1-9]\d*)$/);
    if (checkChannel) {
      const id = Number(checkChannel[2]);
      if (checkChannel[1] === 'check') {
        const checked = await backend('recheckChannel', { ...actor, id });
        if (checked.needsAccess) {
          const platform = checked.platformName;
          const login = platform === 'YouTube' ? 'Google' : platform === 'VK' ? 'VK ID' : platform;
          return send(message.chat.id, `Сначала подключите ${platform} через ${login} аккаунтом владельца канала. Проверка начнётся после подтверждения доступа.`, keyboard([
            [{ text: `Подключить ${platform}`, callback_data: `social:connect:${id}` }],
            [{ text: `Инструкция ${platform} файлом`, callback_data: `social:file:${platform}` }],
            [{ text: 'Мои каналы', callback_data: 'menu:channels' }],
          ]));
        }
        const checkText = checked.inProgress ? 'Этот канал уже проверяется. Ниже — текущие показатели; результат можно открыть через несколько минут.'
          : !checked.queued && checked.retryAfterSeconds > 0 ? `Проверка уже была запрошена. Повторный запрос доступен через ${checked.retryAfterSeconds} сек. Ниже — текущие показатели.`
            : checked.queued ? 'Запрос на проверку принят. Сбор выполняется в очереди: подключённый аккаунт сам по себе ещё не означает, что показатели получены. Ниже — текущий результат; кнопку можно открыть повторно через несколько минут.'
              : 'Не удалось поставить новую проверку: состояние канала изменилось. Ниже — текущий статус. При необходимости возобновите сбор и повторите проверку.';
        await send(message.chat.id, checkText, {});
      }
      return channels(message.chat.id, actor, 0, 'own', id);
    }
    const connectionPlatform = data.match(/^connections:([A-Za-z]+)$/);
    if (connectionPlatform && Object.hasOwn(socialInstructions, connectionPlatform[1])) return connectionMenu(message.chat.id, actor, connectionPlatform[1]);
    const step = data.match(/^(guide:link|social:help):([A-Za-z]+)(?::(\d{1,2}))?$/);
    if (step) return instruction(message.chat.id, step[2], Number(step[3] || 0), step[1] === 'guide:link' ? 'link' : 'api');
    const social = data.match(/^social:(connect|personal|disconnect|confirm-disconnect):([1-9]\d*)(?::([a-f0-9]{16}))?$/);
    if (social) {
      const id = Number(social[2]);
      if (social[1] === 'connect' || social[1] === 'personal') return openConnection(message.chat.id, actor, id);
      if (social[1] === 'confirm-disconnect') {
        if (!confirmation || confirmation.action !== 'disconnect' || confirmation.id !== id || confirmation.nonce !== social[3] || confirmation.expiresAt < Date.now()) return send(message.chat.id, 'Это старое подтверждение. Доступ не изменён. Откройте /channels.');
        await backend('disconnectSocial', { ...actor, id });
        return send(message.chat.id, 'Сохранённый доступ удалён из платформы. Канал и статистика остались. Само разрешение приложения можно отозвать в настройках соцсети.');
      }
      const result = await backend('channels', { ...actor, scope: 'own' });
      const channel = result.channels?.find((c) => c.id === id && String(c.creatorTelegramId) === actor.telegramUserId);
      if (!channel) return send(message.chat.id, 'Канал недоступен.');
      const nonce = randomBytes(8).toString('hex');
      remember(confirmations, actor.telegramUserId, { action: 'disconnect', id, nonce });
      return send(message.chat.id, `Удалить сохранённый доступ к ${channel.url}? Статистика останется, но сбор закрытых данных остановится.`, keyboard([[{ text: 'Да, отключить доступ', callback_data: `social:confirm-disconnect:${id}:${nonce}` }], ...homeMenu.reply_markup.inline_keyboard]));
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
      const result = await backend('channels', { ...actor, scope: 'own' });
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
      return channels(message.chat.id, actor, 0, 'own', id);
    }
    if (data === 'menu:home') return showContext(message.chat.id, await backend('context', actor));
    if (data === 'menu:roles') {
      const context = await backend('context', actor);
      return context.dualRole ? showContext(message.chat.id, context) : send(message.chat.id, 'Выберите свою роль:', roles);
    }
    if (data === 'menu:invite-help') return send(message.chat.id, 'Попросите продюсера открыть этого бота → «Я продюсер» → «Добавить креатора» и отправить вам полученную персональную ссылку.\n\nОткройте её и нажмите «Запустить», если Telegram предложит. Или просто скопируйте ссылку целиком и отправьте сюда. Обычная ссылка на бота без приглашения не подключает к команде.', invitationHelp);
    if (data === 'onboarding:resume') {
      const context = await backend('context', actor);
      return showContext(message.chat.id, !context.binding?.typeConfirmedAt && context.selectedType && ['creator', 'producer'].includes(context.role)
        ? await backend('selectType', { ...actor, type: context.selectedType }) : context);
    }
    if (data === 'menu:add-channel') {
      const context = await backend('context', actor);
      return context.canSubmit ? send(message.chat.id, 'Какая соцсеть?', platformsKeyboard()) : showContext(message.chat.id, context);
    }
    const channelPage = data.match(/^channels:(\d{1,5})$/);
    if (channelPage) return channels(message.chat.id, actor, Number(channelPage[1]));
    const teamPage = data.match(/^team-channels:(\d{1,5})$/);
    if (data === 'menu:team-channels' || teamPage) return channels(message.chat.id, actor, Number(teamPage?.[1] || 0), 'team');
    const role = data.match(/^role:(producer|creator)$/);
    if (role) {
      const context = await backend('context', actor);
      if (context.dualRole && context.canProduce && context.canSubmit) return showContext(message.chat.id, context);
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
      if (!['creator', 'producer'].includes(context.role) || context.binding?.typeConfirmedAt) return showContext(message.chat.id, context);
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
