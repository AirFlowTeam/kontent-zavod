import { randomBytes } from 'node:crypto';
import { extractMessageUrls } from './telegram-bot-lib.mjs';

const keyboard = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const back = [{ text: '⌂ Админ-меню', callback_data: 'admin:home' }];
const labels = { users: 'Все пользователи', creators: 'Все креаторы', producers: 'Все продюсеры', channels: 'Все каналы' };
const contact = (id, username) => `${username ? `@${username} · ` : ''}${id || 'Telegram не привязан'}`;
const metric = (value) => value == null ? 'недоступно' : Number(value).toLocaleString('ru-RU');

export function createTelegramAdminFlow({ backend, send, botUsername, showPersonal }) {
  const pending = new Map();
  const remember = (actor, value) => {
    for (const [id, entry] of pending) if (entry.expiresAt <= Date.now()) pending.delete(id);
    pending.set(actor.telegramUserId, { ...value, expiresAt: Date.now() + 600_000 });
  };
  async function home(chatId, actor) {
    const { counts } = await backend('adminRead', actor);
    await send(chatId, `Администратор · ${actor.telegramUserId}\n\nПользователи: ${counts.users}\nПродюсеры: ${counts.producers}\nКреаторы: ${counts.creators}\nКаналы: ${counts.channels}\n\nЗдесь видны все команды. Можно менять ссылки, приостанавливать сбор и удалять каналы. Для личных ссылок и API выберите «Режим креатора». Чужие ключи подключают только их владельцы.`, keyboard([
      [{ text: labels.users, callback_data: 'admin:list:users:0' }, { text: labels.creators, callback_data: 'admin:list:creators:0' }],
      [{ text: labels.producers, callback_data: 'admin:list:producers:0' }, { text: labels.channels, callback_data: 'admin:list:channels:0' }],
      [{ text: 'Режим продюсера', callback_data: 'admin:mode:producer' }, { text: 'Режим креатора', callback_data: 'admin:mode:creator' }],
      [{ text: 'Инструкции всех площадок', callback_data: 'menu:social' }],
    ]));
  }
  async function channel(chatId, actor, id) {
    const { item: c } = await backend('adminRead', { ...actor, entity: 'channels', id });
    await send(chatId, `${c.platformName} · ${c.title || c.creatorName}\n${c.normalizedUrl}\n\nКреатор: ${c.creatorName} · ${contact(c.creatorTelegramId, c.creatorTelegramUsername)}\nПродюсер: ${c.producerName} · ${contact(c.producerTelegramId, c.producerTelegramUsername)}\nТип: ${c.creatorType}\n\nПросмотры: ${metric(c.effectiveTotalViews)}\nПубликации: ${metric(c.effectivePublicationCount)}\nЛайки: ${metric(c.effectiveTotalLikes)}\nСбор: ${c.status === 'active' ? 'включён' : 'приостановлен'}\nAPI: ${c.connectionStatus || 'не подключён'}`, keyboard([
      [{ text: 'Изменить ссылку', callback_data: `admin:edit:${id}` }, { text: 'Удалить канал', callback_data: `admin:delete:${id}` }],
      [{ text: c.status === 'active' ? 'Приостановить сбор' : 'Возобновить сбор', callback_data: `admin:${c.status === 'active' ? 'pause' : 'resume'}:${id}` }],
      [{ text: 'Инструкция площадки', callback_data: `social:help:${c.platformName}` }], back,
    ]));
  }
  async function list(chatId, actor, entity, page) {
    const result = await backend('adminRead', { ...actor, entity, page });
    const rows = [], lines = result.items.map((item) => {
      if (entity === 'channels') {
        rows.push([{ text: `${item.platformName} · ${item.creatorName}`.slice(0, 60), callback_data: `admin:channel:${item.id}` }]);
        return `${item.creatorName} · ${item.platformName}\n${item.normalizedUrl}`;
      }
      if (entity === 'users') return `${item.displayName || item.username || 'Пользователь'}\n${contact(item.telegramUserId, item.username)}\n${item.stage} · каналов: ${item.channelCount}\nПродюсер: ${item.producerName || 'не выбран'}`;
      if (entity === 'producers') rows.push([{ text: `Пригласить к ${item.name}`.slice(0, 60), callback_data: `admin:invite:${item.id}` }]);
      return `${item.name} · ${item.status === 'active' ? 'активен' : 'отключён'}${entity === 'creators' ? `\n${item.type} · продюсер: ${item.producerName}` : ''}`;
    });
    const navigation = [];
    if (page) navigation.push({ text: '← Назад', callback_data: `admin:list:${entity}:${page - 1}` });
    if (result.hasNext) navigation.push({ text: 'Далее →', callback_data: `admin:list:${entity}:${page + 1}` });
    await send(chatId, `${labels[entity]} · ${result.total}\nСтраница ${page + 1}\n\n${lines.join('\n\n') || 'Список пуст.'}`, keyboard([...rows, ...(navigation.length ? [navigation] : []), back]));
  }
  async function handleMessage(message, actor) {
    const text = (message.text || '').trim(), chatId = message.chat.id;
    const edit = pending.get(actor.telegramUserId);
    if (text.startsWith('/')) pending.delete(actor.telegramUserId);
    if (/^\/admin(?:@\w+)?$/i.test(text)) { await home(chatId, actor); return true; }
    if (/^\/start(?:@\w+)?$/i.test(text) && (await backend('context', actor)).isAdmin) { await home(chatId, actor); return true; }
    if (!edit) return false;
    pending.delete(actor.telegramUserId);
    if (text.startsWith('/')) return false;
    if (edit.operation !== 'edit' || edit.expiresAt <= Date.now()) {
      await send(chatId, 'Действие отменено или истекло. Откройте /admin.', keyboard([back])); return true;
    }
    await backend('adminRead', actor); // Revoked access also invalidates an existing edit prompt.
    const urls = extractMessageUrls(message);
    if (urls.length !== 1) {
      remember(actor, edit);
      await send(chatId, 'Отправьте одну новую ссылку на канал. /cancel — отменить.', keyboard([back])); return true;
    }
    await backend('adminManageChannel', { ...actor, id: edit.id, operation: 'edit', url: urls[0] });
    await send(chatId, 'Ссылка изменена. Старые показатели не переносятся на новый адрес.', keyboard([back]));
    return true;
  }
  async function handleCallback(callback, actor, updateId) {
    const data = callback.data || '', chatId = callback.message.chat.id;
    const confirmation = pending.get(actor.telegramUserId);
    pending.delete(actor.telegramUserId);
    if (!data.startsWith('admin:')) return false;
    await backend('adminRead', actor); // Every button is checked server-side, including stale keyboards.
    if (data === 'admin:home') await home(chatId, actor);
    else if (data === 'admin:mode:producer') await showPersonal(chatId, await backend('role', { ...actor, role: 'producer' }));
    else if (data === 'admin:mode:creator') {
      const context = await backend('context', actor);
      if (context.binding) await showPersonal(chatId, await backend('adminCreator', actor));
      else await send(chatId, 'Создадим ваш личный профиль креатора в вашей команде. Чужое приглашение не нужно. Сначала выберите тип контента:', keyboard([
        [{ text: 'ИИ-контент', callback_data: 'admin:type:AI' }, { text: 'UGC', callback_data: 'admin:type:UGC' }], back,
      ]));
    } else if (/^admin:type:(AI|UGC)$/.test(data)) await showPersonal(chatId, await backend('adminCreator', { ...actor, type: data.split(':')[2] }));
    else if (/^admin:list:(users|creators|producers|channels):\d{1,6}$/.test(data)) {
      const [, , entity, page] = data.split(':'); await list(chatId, actor, entity, Number(page));
    } else if (/^admin:invite:[1-9]\d*$/.test(data)) {
      const { invite } = await backend('adminInvite', { ...actor, producerId: Number(data.split(':')[2]), updateId });
      await send(chatId, `Личное приглашение в команду «${invite.producerName}»:\nhttps://t.me/${botUsername()}?start=c_${invite.token}\n\nПередайте одному креатору. Срок — 7 дней.`, keyboard([back]));
    } else {
      const match = data.match(/^admin:(channel|edit|delete|pause|resume|confirm-delete):([1-9]\d*)(?::([a-f0-9]{16}))?$/);
      if (!match) { await home(chatId, actor); return true; }
      const [, operation, rawId, nonce] = match, id = Number(rawId);
      if (operation === 'channel') await channel(chatId, actor, id);
      else if (operation === 'edit') {
        const { item } = await backend('adminRead', { ...actor, entity: 'channels', id });
        remember(actor, { operation, id });
        await send(chatId, `Редактируем канал «${item.creatorName}»:\n${item.normalizedUrl}\n\nПришлите одну новую ссылку на канал. /cancel — отменить.`, keyboard([back]));
      } else if (operation === 'delete') {
        const { item } = await backend('adminRead', { ...actor, entity: 'channels', id });
        const fresh = randomBytes(8).toString('hex'); remember(actor, { operation, id, nonce: fresh });
        await send(chatId, `Удалить канал «${item.creatorName}»?\n${item.normalizedUrl}\n\nКанал исчезнет из списков, сбор остановится. Остальные каналы и профиль останутся.`, keyboard([[{ text: 'Да, удалить', callback_data: `admin:confirm-delete:${id}:${fresh}` }], back]));
      } else if (operation === 'confirm-delete') {
        if (confirmation?.operation !== 'delete' || confirmation.id !== id || confirmation.nonce !== nonce || confirmation.expiresAt <= Date.now()) {
          await send(chatId, 'Это старое подтверждение. Ничего не удалено.', keyboard([back])); return true;
        }
        await backend('adminManageChannel', { ...actor, id, operation: 'delete' });
        await send(chatId, 'Канал удалён из списка, сбор остановлен.', keyboard([back]));
      } else {
        await backend('adminManageChannel', { ...actor, id, operation }); await channel(chatId, actor, id);
      }
    }
    return true;
  }
  return { handleMessage, handleCallback, cancel: (id) => pending.delete(String(id)) };
}
