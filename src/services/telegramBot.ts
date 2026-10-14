import { db, sqlite } from '../db/connection.js';
import { telegramChats, groups, groupMembers, dailyTasks, userProfiles } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import {
  TELL_ME_THE_STATUS_STICKER,
  ZERO_BUGS_STICKER,
  COMMAND,
  tgBotDisplayCommands,
  CALLBACK_ACTIONS,
  strings,
  genRandomErrorMessageForCompletedDaily,
  genRandomErrorMessageForPrivateEmptyDaily,
  getRandomErrorMessageForPublicEmptyDaily,
  getRandomRequestMessageForPrivateEmptyDaily,
  getRandomSavelysSticker,
} from '../constants/botStrings.js';
import { getReportingDateInfo, isGroupReportTimePassed } from '../utils/dateUtils.js';
import { generateGroupXlsxBuffer, type ExportPeriod } from '../utils/xlsxExport.js';

interface EditSession {
  step: 'waiting_yesterday' | 'waiting_today' | 'waiting_both_yesterday' | 'waiting_both_today';
  groupId: string;
  memberId: string;
  reportDate: string;
  isoDate: string;
  newYesterday?: string;
}

const getDailyActionButtons = (showGroupSwitch: boolean = false, currentGroupName?: string) => {
  const rows: any[][] = [
    [
      { text: '✏️ Редактировать', callback_data: CALLBACK_ACTIONS.EDIT_DAILY },
      { text: '🗑 Удалить', callback_data: CALLBACK_ACTIONS.DELETE_DAILY },
    ],
  ];
  if (showGroupSwitch && currentGroupName) {
    rows.push([{ text: `🔄 Группа: ${currentGroupName} (сменить)`, callback_data: 'open_group_switch' }]);
  }
  return { inline_keyboard: rows };
};

const getEditChoiceButtons = () => ({
  inline_keyboard: [
    [
      { text: '1️⃣ Что делал', callback_data: CALLBACK_ACTIONS.EDIT_YESTERDAY },
      { text: '2️⃣ Что буду делать', callback_data: CALLBACK_ACTIONS.EDIT_TODAY },
    ],
    [
      { text: '🔄 Весь дейлик', callback_data: CALLBACK_ACTIONS.EDIT_BOTH },
      { text: '❌ Отмена', callback_data: CALLBACK_ACTIONS.EDIT_CANCEL },
    ],
  ],
});

const getCancelButton = () => ({
  inline_keyboard: [[{ text: '❌ Отмена', callback_data: CALLBACK_ACTIONS.EDIT_CANCEL }]],
});

export class TelegramBotService {
  private static offset = 0;
  private static isPolling = false;
  private static detectedBotUsername = (process.env.TELEGRAM_BOT_USERNAME || 'daily_service_bot').replace(/^@/, '');
  private static editSessions = new Map<string, EditSession>();
  private static activeGroupByChatId = new Map<string, string>();
  private static linkCodes = new Map<string, { userId: string; expiresAt: number }>();

  private static getApiBase(): string {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    return `https://api.telegram.org/bot${token}`;
  }

  public static getBotUsername(): string {
    return this.detectedBotUsername;
  }

  public static async start() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token || token === 'your_telegram_bot_token_here') {
      console.warn('[Telegram Bot] TELEGRAM_BOT_TOKEN не задан, polling не запущен.');
      return;
    }
    if (this.isPolling) return;
    this.isPolling = true;
    await this.fetchBotInfo();
    await this.registerCommands();
    this.pollUpdates();
  }

  private static async fetchBotInfo() {
    try {
      const res = await fetch(`${this.getApiBase()}/getMe`);
      const data = (await res.json()) as any;
      if (data.ok && data.result?.username) {
        this.detectedBotUsername = data.result.username;
        console.log(`[Telegram Bot] Запущен бот @${this.detectedBotUsername}`);
      }
    } catch (e) {
      console.error('[Telegram Bot] Ошибка getMe:', e);
    }
  }

  public static async registerCommands() {
    try {
      const response = await fetch(`${this.getApiBase()}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: tgBotDisplayCommands }),
      });
      const data = (await response.json()) as any;
      if (data.ok) {
        console.log('[Telegram Bot] Команды успешно зарегистрированы.');
      }
    } catch (error) {
      console.error('[Telegram Bot] Ошибка setMyCommands:', error);
    }
  }

  public static async sendMessage(
    chatId: string,
    text: string,
    options?: {
      parseMode?: string;
      messageThreadId?: number | string | null;
      replyMarkup?: any;
    }
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    try {
      const bodyPayload: any = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      };
      if (options?.parseMode) {
        bodyPayload.parse_mode = options.parseMode;
      }
      if (options?.messageThreadId !== undefined && options?.messageThreadId !== null && options?.messageThreadId !== '') {
        bodyPayload.message_thread_id = Number(options.messageThreadId);
      }
      if (options?.replyMarkup) {
        bodyPayload.reply_markup = options.replyMarkup;
      }

      const response = await fetch(`${this.getApiBase()}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      return await response.json();
    } catch (e) {
      console.error(`[Telegram Bot] sendMessage error (${chatId}):`, e);
      return null;
    }
  }

  public static async sendSticker(chatId: string, stickerId: string, messageThreadId?: number | string | null) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    try {
      const bodyPayload: any = {
        chat_id: chatId,
        sticker: stickerId,
      };
      if (messageThreadId !== undefined && messageThreadId !== null && messageThreadId !== '') {
        bodyPayload.message_thread_id = Number(messageThreadId);
      }
      const response = await fetch(`${this.getApiBase()}/sendSticker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      return await response.json();
    } catch {
      return null;
    }
  }

  public static async sendDocumentBuffer(
    chatId: string,
    buffer: Buffer,
    filename: string,
    messageThreadId?: number | string | null
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      if (messageThreadId !== undefined && messageThreadId !== null && messageThreadId !== '') {
        formData.append('message_thread_id', String(messageThreadId));
      }
      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      formData.append('document', blob, filename);

      const response = await fetch(`${this.getApiBase()}/sendDocument`, {
        method: 'POST',
        body: formData,
      });
      return await response.json();
    } catch (e) {
      console.error('[Telegram Bot] sendDocumentBuffer error:', e);
      return null;
    }
  }

  public static async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    try {
      await fetch(`${this.getApiBase()}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: showAlert,
        }),
      });
    } catch {}
  }

  public static async isUserInChat(chatId: string, telegramUserId: string): Promise<boolean> {
    if (chatId === telegramUserId) return true;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    try {
      const response = await fetch(
        `${this.getApiBase()}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`
      );
      const data = (await response.json()) as any;
      if (data.ok && data.result) {
        const status = data.result.status;
        return ['creator', 'administrator', 'member'].includes(status);
      }
    } catch {}
    return false;
  }

  public static generateLinkCode(userId: string) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const botUsername = this.getBotUsername();
    this.linkCodes.set(code, { userId, expiresAt });
    return {
      code,
      expiresAt,
      botUsername,
      botUrl: `https://t.me/${botUsername}?start=${code}`,
    };
  }

  public static async registerChat(
    chatId: string,
    title?: string,
    type: string = 'group',
    registeredByTelegramId?: string,
    registeredByUsername?: string,
    threadId?: string
  ) {
    try {
      const existing = await db.query.telegramChats.findFirst({
        where: eq(telegramChats.chatId, chatId),
      });

      if (!existing) {
        await db.insert(telegramChats).values({
          id: crypto.randomUUID(),
          chatId,
          threadId: threadId || null,
          title: title || (type === 'private' ? 'Личные сообщения' : 'Группа'),
          type,
          registeredByTelegramId: registeredByTelegramId || null,
          registeredByUsername: registeredByUsername ? registeredByUsername.replace(/^@/, '') : null,
          createdAt: new Date().toISOString(),
        });
      } else {
        const updates: any = {};
        if (title && existing.title !== title) updates.title = title;
        if (registeredByTelegramId && !existing.registeredByTelegramId) {
          updates.registeredByTelegramId = registeredByTelegramId;
        }
        if (registeredByUsername && !existing.registeredByUsername) {
          updates.registeredByUsername = registeredByUsername.replace(/^@/, '');
        }
        if (threadId !== undefined && threadId !== null && existing.threadId !== threadId) {
          updates.threadId = threadId;
        }
        if (Object.keys(updates).length > 0) {
          await db.update(telegramChats).set(updates).where(eq(telegramChats.chatId, chatId));
        }
      }
    } catch (error) {
      console.error('[Telegram Bot] registerChat error:', error);
    }
  }

  public static async unregisterChat(chatId: string) {
    try {
      await db.delete(telegramChats).where(eq(telegramChats.chatId, chatId));
    } catch (error) {
      console.error('[Telegram Bot] unregisterChat error:', error);
    }
  }

  public static async toggleChatActive(chatId: string, isActive: boolean) {
    await db.update(telegramChats).set({ isActive }).where(eq(telegramChats.chatId, chatId));
  }

  // Sync sender's telegramId and username with userProfiles & groupMembers
  private static async syncSenderIdentity(telegramId: string, username?: string, privateChatId?: string) {
    const cleanUsername = username ? username.replace(/^@/, '').trim() : '';
    try {
      if (cleanUsername) {
        sqlite
          .prepare(
            `UPDATE group_members
             SET telegram_id = ?
             WHERE lower(telegram_username) = ? AND (telegram_id IS NULL OR telegram_id != ?)`
          )
          .run(telegramId, cleanUsername.toLowerCase(), telegramId);

        sqlite
          .prepare(
            `UPDATE user_profiles
             SET telegram_id = COALESCE(telegram_id, ?),
                 telegram_chat_id = COALESCE(?, telegram_chat_id, ?)
             WHERE lower(username) = ?`
          )
          .run(telegramId, privateChatId || null, telegramId, cleanUsername.toLowerCase());
      }

      if (privateChatId) {
        sqlite
          .prepare(
            `UPDATE user_profiles
             SET telegram_chat_id = ?, username = COALESCE(username, ?)
             WHERE telegram_id = ?`
          )
          .run(privateChatId, cleanUsername || null, telegramId);
      }
    } catch (e) {
      console.error('[Telegram Bot] syncSenderIdentity error:', e);
    }
  }

  // Find all memberships for a Telegram user across active groups
  public static async getUserMemberships(telegramId: string, username?: string) {
    const cleanUsername = username ? username.replace(/^@/, '').trim().toLowerCase() : '';
    const allMembers = await db.query.groupMembers.findMany({
      where: eq(groupMembers.isActive, true),
    });

    const matchedMembers = allMembers.filter((m) => {
      if (m.telegramId && m.telegramId === telegramId) return true;
      if (cleanUsername && m.telegramUsername.toLowerCase() === cleanUsername) return true;
      return false;
    });

    if (matchedMembers.length === 0) return [];

    const allGroups = await db.query.groups.findMany();
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));

    return matchedMembers
      .map((member) => {
        const group = groupMap.get(member.groupId);
        return group ? { member, group } : null;
      })
      .filter((item): item is { member: typeof groupMembers.$inferSelect; group: typeof groups.$inferSelect } => !!item);
  }

  // Resolve target group & membership for a user in private DM
  private static async resolveActiveMembershipForPrivateChat(
    chatId: string,
    telegramId: string,
    username?: string
  ) {
    const memberships = (await this.getUserMemberships(telegramId, username)).filter(
      (m) => m.member.role !== 'export_only'
    );
    if (memberships.length === 0) return { current: null, all: [] };

    let preferredGroupId = this.activeGroupByChatId.get(chatId);
    if (!preferredGroupId) {
      const profile = await db.query.userProfiles.findFirst({
        where: eq(userProfiles.telegramId, telegramId),
      });
      if (profile?.activeGroupId) {
        preferredGroupId = profile.activeGroupId;
      }
    }

    const found = preferredGroupId
      ? memberships.find((m) => m.group.id === preferredGroupId)
      : undefined;

    const current = found || memberships[0];
    this.activeGroupByChatId.set(chatId, current.group.id);
    return { current, all: memberships };
  }

  // ==================== SCHEDULED & GROUP ACTIONS ====================

  public static async runDailyGroupReport(
    groupId: string,
    triggeredByUsername?: string,
    overrideThreadId?: string | number | null
  ): Promise<{ sent: boolean; message: string }> {
    const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!group || !group.chatId) {
      return { sent: false, message: 'Группа не привязана к Telegram чату' };
    }

    const threadId = overrideThreadId !== undefined ? overrideThreadId : group.threadId;

    if (triggeredByUsername) {
      const isAdmin = await this.isGroupAdmin(group, triggeredByUsername);
      if (!isAdmin) {
        await this.sendMessage(group.chatId, strings.command_not_available, { messageThreadId: threadId });
        return { sent: false, message: strings.command_not_available };
      }
    }

    const { reportDate } = getReportingDateInfo(group);
    const tasks = await db.query.dailyTasks.findMany({
      where: and(eq(dailyTasks.groupId, group.id), eq(dailyTasks.reportDate, reportDate)),
    });
    const members = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, group.id),
    });
    const memberMap = new Map(members.map((m) => [m.id, m]));

    const validResults = tasks
      .filter((t) => !!t.yesterday)
      .map((t) => {
        const m = memberMap.get(t.memberId);
        return {
          name: m?.displayName || t.telegramUsername,
          yesterday: t.yesterday,
          today: t.today || strings.empty,
        };
      });

    let responseMessage = '';
    if (validResults.length > 0) {
      responseMessage = validResults
        .map(
          (result) =>
            `${result.name}:\n\n` +
            `Что делал:\n${result.yesterday}\n\n` +
            `Что буду делать:\n${result.today}` +
            `\n_____________________________\n\n`
        )
        .join('');
    } else {
      responseMessage = getRandomErrorMessageForPublicEmptyDaily();
    }

    await this.sendMessage(group.chatId, responseMessage, { messageThreadId: threadId });
    return { sent: true, message: responseMessage };
  }

  public static async runDailyPublicRemind(
    groupId: string,
    triggeredByUsername?: string,
    overrideThreadId?: string | number | null
  ): Promise<{ sent: boolean; missingUsers: string[] }> {
    const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!group || !group.chatId) {
      return { sent: false, missingUsers: [] };
    }

    const threadId = overrideThreadId !== undefined ? overrideThreadId : group.threadId;

    if (triggeredByUsername) {
      const isAdmin = await this.isGroupAdmin(group, triggeredByUsername);
      if (!isAdmin) {
        await this.sendMessage(group.chatId, strings.command_not_available, { messageThreadId: threadId });
        return { sent: false, missingUsers: [] };
      }
    }

    const { reportDate } = getReportingDateInfo(group);
    const members = await db.query.groupMembers.findMany({
      where: and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.isActive, true),
        eq(groupMembers.includeInDailies, true)
      ),
    });

    const targetMembers = members.filter((m) => m.role !== 'export_only');
    const tasks = await db.query.dailyTasks.findMany({
      where: and(eq(dailyTasks.groupId, group.id), eq(dailyTasks.reportDate, reportDate)),
    });

    const submittedMemberIds = new Set(tasks.filter((t) => !!t.yesterday).map((t) => t.memberId));
    const missingMembers = targetMembers.filter((m) => !submittedMemberIds.has(m.id));

    if (missingMembers.length > 0) {
      const responseMessage = missingMembers.map((m) => `@${m.telegramUsername}`).join(' ');
      await this.sendSticker(group.chatId, TELL_ME_THE_STATUS_STICKER, threadId);
      await this.sendMessage(group.chatId, responseMessage, { messageThreadId: threadId });
    } else {
      await this.sendSticker(group.chatId, ZERO_BUGS_STICKER, threadId);
      await this.sendMessage(group.chatId, strings.congratulation, { messageThreadId: threadId });
    }

    return {
      sent: true,
      missingUsers: missingMembers.map((m) => m.telegramUsername),
    };
  }

  public static async runDailyPrivateRemind(
    groupId: string,
    triggeredByUsername?: string
  ): Promise<{ sentCount: number; missingUsers: string[] }> {
    const group = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!group) {
      return { sentCount: 0, missingUsers: [] };
    }

    if (triggeredByUsername && group.chatId) {
      const isAdmin = await this.isGroupAdmin(group, triggeredByUsername);
      if (!isAdmin) {
        await this.sendMessage(group.chatId, strings.command_not_available, { messageThreadId: group.threadId });
        return { sentCount: 0, missingUsers: [] };
      }
    }

    const { reportDate } = getReportingDateInfo(group);
    const members = await db.query.groupMembers.findMany({
      where: and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.isActive, true),
        eq(groupMembers.includeInDailies, true)
      ),
    });

    const targetMembers = members.filter((m) => m.role !== 'export_only');
    const tasks = await db.query.dailyTasks.findMany({
      where: and(eq(dailyTasks.groupId, group.id), eq(dailyTasks.reportDate, reportDate)),
    });

    const submittedMemberIds = new Set(tasks.filter((t) => !!t.yesterday).map((t) => t.memberId));
    const missingMembers = targetMembers.filter((m) => !submittedMemberIds.has(m.id));

    let sentCount = 0;
    for (const member of missingMembers) {
      let dmChatId = member.telegramId;
      if (!dmChatId && member.userProfileId) {
        const prof = await db.query.userProfiles.findFirst({
          where: eq(userProfiles.id, member.userProfileId),
        });
        dmChatId = prof?.telegramChatId || prof?.telegramId || null;
      }
      if (!dmChatId) {
        const profByUsername = sqlite
          .prepare(`SELECT telegram_chat_id, telegram_id FROM user_profiles WHERE lower(username) = ? LIMIT 1`)
          .get(member.telegramUsername.toLowerCase()) as any;
        dmChatId = profByUsername?.telegram_chat_id || profByUsername?.telegram_id || null;
      }

      if (dmChatId) {
        await this.sendSticker(dmChatId, TELL_ME_THE_STATUS_STICKER);
        await this.sendMessage(dmChatId, getRandomRequestMessageForPrivateEmptyDaily());
        sentCount++;
      }
    }

    return {
      sentCount,
      missingUsers: missingMembers.map((m) => m.telegramUsername),
    };
  }

  private static async isGroupAdmin(group: typeof groups.$inferSelect, username?: string, telegramId?: string): Promise<boolean> {
    const adminProfile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, group.adminUserId),
    });
    if (adminProfile) {
      if (telegramId && adminProfile.telegramId === telegramId) return true;
      if (username && adminProfile.username?.toLowerCase() === username.replace(/^@/, '').toLowerCase()) {
        return true;
      }
    }

    if (username) {
      const members = await db.query.groupMembers.findMany({
        where: eq(groupMembers.groupId, group.id),
      });
      const member = members.find(
        (m) => m.telegramUsername.toLowerCase() === username.replace(/^@/, '').toLowerCase()
      );
      if (member?.role === 'admin') return true;
    }
    return false;
  }

  // ==================== UPDATE PROCESSING ====================

  private static async processUpdate(update: any) {
    if (update.my_chat_member) {
      const chat = update.my_chat_member.chat;
      const newStatus = update.my_chat_member.new_chat_member?.status;
      const fromUser = update.my_chat_member.from;

      if (['member', 'administrator'].includes(newStatus)) {
        await this.registerChat(
          chat.id.toString(),
          chat.title,
          chat.type,
          fromUser?.id?.toString(),
          fromUser?.username
        );
        if (chat.type === 'group' || chat.type === 'supergroup') {
          await this.sendMessage(
            chat.id.toString(),
            `🤖 <b>Daily Standup Bot добавлен в группу!</b>\n\n` +
              `Чтобы инициализировать сбор дейликов в этой группе:\n` +
              `1️⃣ Авторизуйтесь в веб-интерфейсе и нажмите <b>«Подключить группу»</b>, либо\n` +
              `2️⃣ Отправьте здесь команду <code>/init</code> (или <code>/init КОД</code> из веб-панели).\n\n` +
              `ID этого чата: <code>${chat.id}</code>`,
            { parseMode: 'HTML' }
          );
        }
      } else if (['left', 'kicked'].includes(newStatus)) {
        await this.unregisterChat(chat.id.toString());
      }
      return;
    }

    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    if (update.message) {
      await this.handleMessage(update.message);
    }
  }

  private static async handleMessage(msg: any) {
    const chatId = msg.chat?.id?.toString();
    if (!chatId) return;

    const threadId = msg.message_thread_id;
    const senderTelegramId = msg.from?.id?.toString() || '';
    const senderUsername = msg.from?.username || '';
    const text = (msg.text || '').trim();
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    await this.registerChat(
      chatId,
      msg.chat.title || msg.chat.username || msg.from?.first_name,
      msg.chat.type,
      senderTelegramId,
      senderUsername,
      threadId?.toString()
    );

    if (senderTelegramId) {
      await this.syncSenderIdentity(senderTelegramId, senderUsername, isGroup ? undefined : chatId);
    }

    if (!text) return;

    const parts = text.split(/\s+/);
    const rawCommand = parts[0] || '';
    const command = rawCommand.split('@')[0].toLowerCase();
    const argument = parts[1];

    // 1. Account Link Code (/start 123456 or /link 123456)
    if ((command === COMMAND.START || command === COMMAND.LINK) && argument && /^\d{6}$/.test(argument)) {
      await this.handleLinkCode(chatId, senderTelegramId, senderUsername, argument, threadId);
      return;
    }

    // 2. Group Initialization (/init or /init CODE)
    if (command === COMMAND.INIT || (command === COMMAND.START && argument?.startsWith('init_'))) {
      const code = command === COMMAND.INIT ? argument : argument?.replace(/^init_/, '');
      await this.handleInitCommand(chatId, msg.chat.title || 'Команда', isGroup, senderTelegramId, senderUsername, code, threadId);
      return;
    }

    // 3. /chat_id
    if (command === COMMAND.CHAT_ID) {
      const replyText = threadId
        ? `Chat ID: <code>${chatId}</code>\nThread ID: <code>${threadId}</code>`
        : `<code>${chatId}</code>`;
      await this.sendMessage(chatId, replyText, { parseMode: 'HTML', messageThreadId: threadId });
      return;
    }

    // 4. /unlink
    if (command === COMMAND.UNLINK) {
      sqlite
        .prepare(`UPDATE user_profiles SET telegram_id = NULL, telegram_chat_id = NULL WHERE telegram_id = ?`)
        .run(senderTelegramId);
      await this.sendMessage(chatId, '🔓 <b>Ваш Telegram-аккаунт отвязан от веб-профиля.</b>', {
        parseMode: 'HTML',
        messageThreadId: threadId,
      });
      return;
    }

    // ==================== GROUP CHAT COMMANDS ====================
    if (isGroup) {
      const group = await db.query.groups.findFirst({
        where: eq(groups.chatId, chatId),
      });

      if (command === COMMAND.START) {
        await this.sendSticker(chatId, TELL_ME_THE_STATUS_STICKER, threadId);
        if (!group) {
          await this.sendMessage(
            chatId,
            `Бот еще не инициализирован в этой группе. Отправьте <code>/init</code> для запуска или привяжите чат в веб-интерфейсе.`,
            { parseMode: 'HTML', messageThreadId: threadId }
          );
        }
        return;
      }

      if (!group) {
        if (command.startsWith('/')) {
          await this.sendMessage(
            chatId,
            `⚠️ Эта группа еще не подключена к сервису дейликов. Отправьте <code>/init</code> или подключите чат (ID: <code>${chatId}</code>) в веб-интерфейсе.`,
            { parseMode: 'HTML', messageThreadId: threadId }
          );
        }
        return;
      }

      const members = await db.query.groupMembers.findMany({
        where: and(eq(groupMembers.groupId, group.id), eq(groupMembers.isActive, true)),
      });
      const senderMember = members.find(
        (m) =>
          (senderUsername && m.telegramUsername.toLowerCase() === senderUsername.toLowerCase()) ||
          (senderTelegramId && m.telegramId === senderTelegramId)
      );
      const isSenderAdmin = await this.isGroupAdmin(group, senderUsername, senderTelegramId);

      // Export commands in group
      if (
        command === COMMAND.EXPORT_XLSX ||
        command === COMMAND.EXPORT_XLSX_MONTH ||
        command === COMMAND.EXPORT_XLSX_WEEK
      ) {
        if (!isSenderAdmin && !senderMember) {
          await this.sendMessage(chatId, strings.you_do_not_have_access_to_this_bot, { messageThreadId: threadId });
          return;
        }
        const period: ExportPeriod =
          command === COMMAND.EXPORT_XLSX_WEEK
            ? 'week'
            : command === COMMAND.EXPORT_XLSX_MONTH
              ? 'month'
              : 'all';
        const { buffer, filename } = await generateGroupXlsxBuffer(group.id, period);
        await this.sendDocumentBuffer(chatId, buffer, filename, threadId);
        return;
      }

      if (!isSenderAdmin && (!senderMember || senderMember.role === 'export_only')) {
        if (command.startsWith('/')) {
          await this.sendMessage(chatId, strings.you_do_not_have_access_to_this_bot, { messageThreadId: threadId });
        }
        return;
      }

      if (command === COMMAND.INFO) {
        await this.runDailyGroupReport(group.id, senderUsername || 'withoutUsername', threadId);
        return;
      }
      if (command === COMMAND.REMIND) {
        await this.runDailyPublicRemind(group.id, senderUsername || 'withoutUsername', threadId);
        return;
      }
      if (command === COMMAND.REMIND_PRIVATE) {
        await this.runDailyPrivateRemind(group.id, senderUsername || 'withoutUsername');
        return;
      }
      if (command === COMMAND.TEG_ALL) {
        const tagTargets = members
          .filter((m) => m.role !== 'export_only' && m.telegramUsername.toLowerCase() !== senderUsername.toLowerCase())
          .map((m) => `@${m.telegramUsername}`);
        if (tagTargets.length > 0) {
          await this.sendMessage(chatId, tagTargets.join(' '), { messageThreadId: threadId });
        }
        return;
      }
      if (command === COMMAND.BUG_ON_PRE_PROD) {
        await this.sendSticker(chatId, getRandomSavelysSticker(), threadId);
        await this.sendMessage(chatId, strings.bugOnPreProd, { messageThreadId: threadId });
        const tagTargets = members
          .filter((m) => m.role !== 'export_only' && m.telegramUsername.toLowerCase() !== senderUsername.toLowerCase())
          .map((m) => `@${m.telegramUsername}`);
        if (tagTargets.length > 0) {
          await this.sendMessage(chatId, tagTargets.join(' '), { messageThreadId: threadId });
        }
        return;
      }
      if (command === COMMAND.BUG_ON_PROD) {
        await this.sendSticker(chatId, getRandomSavelysSticker(), threadId);
        await this.sendMessage(chatId, strings.bugOnProd, { messageThreadId: threadId });
        const tagTargets = members
          .filter((m) => m.role !== 'export_only' && m.telegramUsername.toLowerCase() !== senderUsername.toLowerCase())
          .map((m) => `@${m.telegramUsername}`);
        if (tagTargets.length > 0) {
          await this.sendMessage(chatId, tagTargets.join(' '), { messageThreadId: threadId });
        }
        return;
      }
      return;
    }

    // ==================== PRIVATE DM COMMANDS & STANDUP SUBMISSION ====================

    // Cancel editing session
    if (command === '/cancel' || text.toLowerCase() === 'отмена') {
      if (this.editSessions.has(chatId)) {
        this.editSessions.delete(chatId);
        await this.sendMessage(chatId, strings.edit_cancelled);
        return;
      }
    }

    // Clear edit session on any slash command
    if (text.startsWith('/')) {
      this.editSessions.delete(chatId);
    }

    const allMemberships = await this.getUserMemberships(senderTelegramId, senderUsername);

    // Export commands in private DM
    if (
      command === COMMAND.EXPORT_XLSX ||
      command === COMMAND.EXPORT_XLSX_MONTH ||
      command === COMMAND.EXPORT_XLSX_WEEK
    ) {
      const exportable = allMemberships.filter(
        (m) => m.member.canExportXlsx || m.member.role === 'admin' || m.member.role === 'member'
      );
      if (exportable.length === 0) {
        await this.sendMessage(chatId, strings.you_do_not_have_access_to_this_bot);
        return;
      }
      const preferredId = this.activeGroupByChatId.get(chatId);
      const target = exportable.find((m) => m.group.id === preferredId) || exportable[0];
      const period: ExportPeriod =
        command === COMMAND.EXPORT_XLSX_WEEK
          ? 'week'
          : command === COMMAND.EXPORT_XLSX_MONTH
            ? 'month'
            : 'all';
      const { buffer, filename } = await generateGroupXlsxBuffer(target.group.id, period);
      await this.sendDocumentBuffer(chatId, buffer, filename);
      return;
    }

    if (command === COMMAND.START) {
      await this.sendSticker(chatId, TELL_ME_THE_STATUS_STICKER);
      const { current, all } = await this.resolveActiveMembershipForPrivateChat(
        chatId,
        senderTelegramId,
        senderUsername
      );
      let extraInfo = '';
      if (all.length > 1 && current) {
        extraInfo = `\n\n📌 <b>Активная группа для дейлика:</b> ${this.escapeHtml(current.group.name)}\nДля переключения группы используйте /group`;
      } else if (all.length === 1 && current) {
        extraInfo = `\n\n📌 <b>Группа:</b> ${this.escapeHtml(current.group.name)}`;
      }
      await this.sendMessage(chatId, strings.introductory_instructions + extraInfo, { parseMode: 'HTML' });
      return;
    }

    if (command === COMMAND.TEG_ALL || command === COMMAND.BUG_ON_PROD || command === COMMAND.BUG_ON_PRE_PROD) {
      await this.sendMessage(chatId, strings.can_only_be_used_in_groups);
      return;
    }

    const { current, all } = await this.resolveActiveMembershipForPrivateChat(
      chatId,
      senderTelegramId,
      senderUsername
    );

    if (!current) {
      await this.sendMessage(chatId, strings.you_are_not_in_the_system);
      return;
    }

    // /group command to switch active group when user is in multiple groups
    if (command === COMMAND.GROUP) {
      await this.sendGroupSelectionPrompt(chatId, all, current.group.id);
      return;
    }

    if (command === COMMAND.INFO) {
      await this.handlePrivateInfo(chatId, current.group, current.member, all.length > 1);
      return;
    }

    if (command === COMMAND.EDIT_DAILY) {
      await this.handlePrivateEditStart(chatId, current.group, current.member);
      return;
    }

    if (command === COMMAND.DELETE_DAILY) {
      await this.handlePrivateDelete(chatId, current.group, current.member);
      return;
    }

    if (command === COMMAND.REMIND_PRIVATE) {
      await this.runDailyPrivateRemind(current.group.id, senderUsername);
      return;
    }

    // Handle active edit session
    if (this.editSessions.has(chatId)) {
      await this.handleEditSessionMessage(chatId, text, all.length > 1);
      return;
    }

    // Ignore unknown slash commands
    if (text.startsWith('/')) {
      return;
    }

    // Regular text message -> Add Daily (Step 1: Yesterday, Step 2: Today)
    if (!msg.reply_to_message) {
      await this.handlePrivateAddDaily(chatId, text, current.group, current.member, all.length > 1);
    }
  }

  private static async sendGroupSelectionPrompt(
    chatId: string,
    memberships: Array<{ member: typeof groupMembers.$inferSelect; group: typeof groups.$inferSelect }>,
    activeGroupId: string
  ) {
    const inline_keyboard = memberships.map((m) => [
      {
        text: `${m.group.id === activeGroupId ? '✅ ' : ''}${m.group.name}`,
        callback_data: `${CALLBACK_ACTIONS.SELECT_GROUP_PREFIX}${m.group.id}`,
      },
    ]);

    await this.sendMessage(
      chatId,
      `👥 <b>Выберите группу, для которой вы хотите писать или смотреть дейлик:</b>`,
      {
        parseMode: 'HTML',
        replyMarkup: { inline_keyboard },
      }
    );
  }

  private static async handlePrivateInfo(
    chatId: string,
    group: typeof groups.$inferSelect,
    member: typeof groupMembers.$inferSelect,
    isMultiGroup: boolean
  ) {
    const { reportDate } = getReportingDateInfo(group);
    const taskData = await db.query.dailyTasks.findFirst({
      where: and(
        eq(dailyTasks.groupId, group.id),
        eq(dailyTasks.memberId, member.id),
        eq(dailyTasks.reportDate, reportDate)
      ),
    });

    const groupHeader = isMultiGroup ? `📌 <b>Группа: ${this.escapeHtml(group.name)}</b> (${reportDate})\n\n` : '';

    if (taskData?.yesterday || taskData?.today) {
      const canModify = !isGroupReportTimePassed(group);
      const replyMarkup = canModify ? getDailyActionButtons(isMultiGroup, group.name) : undefined;
      const body =
        `${groupHeader}<b>Что делал:</b>\n${this.escapeHtml(taskData.yesterday)}\n\n` +
        `<b>Что буду делать:</b>\n${
          taskData.today
            ? this.escapeHtml(taskData.today)
            : `${strings.empty}\n${strings.send_a_message_and_it_will_be_added_here}`
        }`;
      await this.sendMessage(chatId, body, { parseMode: 'HTML', replyMarkup });
    } else {
      await this.sendMessage(chatId, groupHeader + genRandomErrorMessageForPrivateEmptyDaily(), {
        parseMode: 'HTML',
      });
    }
  }

  private static async handlePrivateAddDaily(
    chatId: string,
    text: string,
    group: typeof groups.$inferSelect,
    member: typeof groupMembers.$inferSelect,
    isMultiGroup: boolean
  ) {
    const { reportDate, isoDate } = getReportingDateInfo(group);
    const existingTask = await db.query.dailyTasks.findFirst({
      where: and(
        eq(dailyTasks.groupId, group.id),
        eq(dailyTasks.memberId, member.id),
        eq(dailyTasks.reportDate, reportDate)
      ),
    });

    if (existingTask?.today) {
      if (isGroupReportTimePassed(group)) {
        await this.sendMessage(chatId, genRandomErrorMessageForCompletedDaily());
      } else {
        await this.sendMessage(chatId, strings.daily_already_submitted_with_actions, {
          replyMarkup: getDailyActionButtons(isMultiGroup, group.name),
        });
      }
      return;
    }

    if (text.length < 9) {
      await this.sendMessage(chatId, strings.soLittle);
      return;
    }
    if (text.length > 560) {
      await this.sendMessage(chatId, strings.soLong);
      return;
    }

    const now = new Date().toISOString();
    const groupBadge = isMultiGroup ? `\n<i>(Группа: ${this.escapeHtml(group.name)})</i>` : '';

    if (existingTask?.id) {
      // Step 2: Update today
      await db
        .update(dailyTasks)
        .set({ today: text, updatedAt: now })
        .where(eq(dailyTasks.id, existingTask.id));

      await this.sendMessage(chatId, strings.super_your_daily_has_been_recorded + groupBadge, {
        parseMode: 'HTML',
        replyMarkup: getDailyActionButtons(isMultiGroup, group.name),
      });
    } else {
      // Step 1: Create yesterday
      await db.insert(dailyTasks).values({
        id: crypto.randomUUID(),
        groupId: group.id,
        memberId: member.id,
        userProfileId: member.userProfileId || null,
        telegramUsername: member.telegramUsername,
        yesterday: text,
        today: null,
        reportDate,
        isoDate,
        createdAt: now,
        updatedAt: now,
      });

      await this.sendMessage(chatId, strings.great_Now_write_what_you_will_do + groupBadge, {
        parseMode: 'HTML',
      });
    }
  }

  private static async handlePrivateEditStart(
    chatId: string,
    group: typeof groups.$inferSelect,
    member: typeof groupMembers.$inferSelect
  ) {
    if (isGroupReportTimePassed(group)) {
      await this.sendMessage(chatId, strings.cannot_edit_after_report);
      return;
    }

    const { reportDate } = getReportingDateInfo(group);
    const todayTask = await db.query.dailyTasks.findFirst({
      where: and(
        eq(dailyTasks.groupId, group.id),
        eq(dailyTasks.memberId, member.id),
        eq(dailyTasks.reportDate, reportDate)
      ),
    });

    if (!todayTask?.id || (!todayTask.yesterday && !todayTask.today)) {
      await this.sendMessage(chatId, strings.no_daily_to_edit);
      return;
    }

    const dailyText =
      `<b>Твой текущий дейлик на сегодня (${this.escapeHtml(group.name)}):</b>\n\n` +
      `<b>Что делал:</b>\n${this.escapeHtml(todayTask.yesterday || strings.empty)}\n\n` +
      `<b>Что буду делать:</b>\n${this.escapeHtml(todayTask.today || strings.empty)}\n\n` +
      `${strings.edit_select_part}`;

    await this.sendMessage(chatId, dailyText, {
      parseMode: 'HTML',
      replyMarkup: getEditChoiceButtons(),
    });
  }

  private static async handlePrivateDelete(
    chatId: string,
    group: typeof groups.$inferSelect,
    member: typeof groupMembers.$inferSelect
  ) {
    if (isGroupReportTimePassed(group)) {
      await this.sendMessage(chatId, strings.cannot_delete_after_report);
      return;
    }

    const { reportDate } = getReportingDateInfo(group);
    const todayTask = await db.query.dailyTasks.findFirst({
      where: and(
        eq(dailyTasks.groupId, group.id),
        eq(dailyTasks.memberId, member.id),
        eq(dailyTasks.reportDate, reportDate)
      ),
    });

    if (!todayTask?.id) {
      await this.sendMessage(chatId, strings.no_daily_to_delete);
      return;
    }

    await db.delete(dailyTasks).where(eq(dailyTasks.id, todayTask.id));
    this.editSessions.delete(chatId);
    await this.sendMessage(chatId, strings.daily_deleted_successfully);
  }

  private static async handleEditSessionMessage(chatId: string, text: string, isMultiGroup: boolean) {
    const session = this.editSessions.get(chatId);
    if (!session) return;

    const group = await db.query.groups.findFirst({ where: eq(groups.id, session.groupId) });
    if (!group || isGroupReportTimePassed(group)) {
      this.editSessions.delete(chatId);
      await this.sendMessage(chatId, strings.cannot_edit_after_report);
      return;
    }

    if (text.length < 9) {
      await this.sendMessage(chatId, strings.soLittle, { replyMarkup: getCancelButton() });
      return;
    }
    if (text.length > 560) {
      await this.sendMessage(chatId, strings.soLong, { replyMarkup: getCancelButton() });
      return;
    }

    const now = new Date().toISOString();

    if (session.step === 'waiting_yesterday') {
      this.editSessions.delete(chatId);
      await db
        .update(dailyTasks)
        .set({ yesterday: text, updatedAt: now })
        .where(
          and(
            eq(dailyTasks.groupId, session.groupId),
            eq(dailyTasks.memberId, session.memberId),
            eq(dailyTasks.reportDate, session.reportDate)
          )
        );

      const updatedTask = await db.query.dailyTasks.findFirst({
        where: and(
          eq(dailyTasks.groupId, session.groupId),
          eq(dailyTasks.memberId, session.memberId),
          eq(dailyTasks.reportDate, session.reportDate)
        ),
      });

      const msg =
        `${strings.edit_yesterday_success}\n\n` +
        `<b>Твой дейлик:</b>\n\n` +
        `<b>Что делал:</b>\n${this.escapeHtml(updatedTask?.yesterday || text)}\n\n` +
        `<b>Что буду делать:</b>\n${this.escapeHtml(updatedTask?.today || strings.empty)}`;

      await this.sendMessage(chatId, msg, {
        parseMode: 'HTML',
        replyMarkup: getDailyActionButtons(isMultiGroup, group.name),
      });
      return;
    }

    if (session.step === 'waiting_today') {
      this.editSessions.delete(chatId);
      await db
        .update(dailyTasks)
        .set({ today: text, updatedAt: now })
        .where(
          and(
            eq(dailyTasks.groupId, session.groupId),
            eq(dailyTasks.memberId, session.memberId),
            eq(dailyTasks.reportDate, session.reportDate)
          )
        );

      const updatedTask = await db.query.dailyTasks.findFirst({
        where: and(
          eq(dailyTasks.groupId, session.groupId),
          eq(dailyTasks.memberId, session.memberId),
          eq(dailyTasks.reportDate, session.reportDate)
        ),
      });

      const msg =
        `${strings.edit_today_success}\n\n` +
        `<b>Твой дейлик:</b>\n\n` +
        `<b>Что делал:</b>\n${this.escapeHtml(updatedTask?.yesterday || strings.empty)}\n\n` +
        `<b>Что буду делать:</b>\n${this.escapeHtml(updatedTask?.today || text)}`;

      await this.sendMessage(chatId, msg, {
        parseMode: 'HTML',
        replyMarkup: getDailyActionButtons(isMultiGroup, group.name),
      });
      return;
    }

    if (session.step === 'waiting_both_yesterday') {
      session.newYesterday = text;
      session.step = 'waiting_both_today';
      await this.sendMessage(chatId, strings.edit_both_step2, {
        parseMode: 'HTML',
        replyMarkup: getCancelButton(),
      });
      return;
    }

    if (session.step === 'waiting_both_today') {
      this.editSessions.delete(chatId);
      await db
        .update(dailyTasks)
        .set({ yesterday: session.newYesterday || '', today: text, updatedAt: now })
        .where(
          and(
            eq(dailyTasks.groupId, session.groupId),
            eq(dailyTasks.memberId, session.memberId),
            eq(dailyTasks.reportDate, session.reportDate)
          )
        );

      const msg =
        `${strings.edit_both_success}\n\n` +
        `<b>Твой дейлик:</b>\n\n` +
        `<b>Что делал:</b>\n${this.escapeHtml(session.newYesterday || '')}\n\n` +
        `<b>Что буду делать:</b>\n${this.escapeHtml(text)}`;

      await this.sendMessage(chatId, msg, {
        parseMode: 'HTML',
        replyMarkup: getDailyActionButtons(isMultiGroup, group.name),
      });
    }
  }

  private static async handleCallbackQuery(query: any) {
    const chatId = query.message?.chat?.id?.toString();
    const data = query.data as string;
    const senderTelegramId = query.from?.id?.toString() || '';
    const senderUsername = query.from?.username || '';

    if (!chatId || !data) return;

    const { current, all } = await this.resolveActiveMembershipForPrivateChat(
      chatId,
      senderTelegramId,
      senderUsername
    );

    if (!current) {
      await this.answerCallbackQuery(query.id, strings.you_do_not_have_access_to_this_bot, true);
      return;
    }

    if (data === 'open_group_switch') {
      await this.answerCallbackQuery(query.id);
      await this.sendGroupSelectionPrompt(chatId, all, current.group.id);
      return;
    }

    if (data.startsWith(CALLBACK_ACTIONS.SELECT_GROUP_PREFIX)) {
      const selectedGroupId = data.slice(CALLBACK_ACTIONS.SELECT_GROUP_PREFIX.length);
      const target = all.find((m) => m.group.id === selectedGroupId);
      if (target) {
        this.activeGroupByChatId.set(chatId, target.group.id);
        sqlite
          .prepare(`UPDATE user_profiles SET active_group_id = ? WHERE telegram_id = ?`)
          .run(target.group.id, senderTelegramId);
        await this.answerCallbackQuery(query.id, `Выбрана группа: ${target.group.name}`);
        await this.sendMessage(
          chatId,
          `✅ <b>Активная группа переключена на:</b> ${this.escapeHtml(target.group.name)}`,
          { parseMode: 'HTML' }
        );
      }
      return;
    }

    if (data === CALLBACK_ACTIONS.EDIT_DAILY) {
      await this.answerCallbackQuery(query.id);
      await this.handlePrivateEditStart(chatId, current.group, current.member);
      return;
    }

    if (data === CALLBACK_ACTIONS.DELETE_DAILY) {
      await this.answerCallbackQuery(query.id);
      await this.handlePrivateDelete(chatId, current.group, current.member);
      return;
    }

    if (data === CALLBACK_ACTIONS.EDIT_CANCEL) {
      this.editSessions.delete(chatId);
      await this.answerCallbackQuery(query.id, strings.edit_cancelled);
      await this.sendMessage(chatId, strings.edit_cancelled);
      return;
    }

    if (
      data === CALLBACK_ACTIONS.EDIT_YESTERDAY ||
      data === CALLBACK_ACTIONS.EDIT_TODAY ||
      data === CALLBACK_ACTIONS.EDIT_BOTH
    ) {
      if (isGroupReportTimePassed(current.group)) {
        await this.answerCallbackQuery(query.id, strings.cannot_edit_after_report, true);
        await this.sendMessage(chatId, strings.cannot_edit_after_report);
        return;
      }

      const { reportDate, isoDate } = getReportingDateInfo(current.group);
      const todayTask = await db.query.dailyTasks.findFirst({
        where: and(
          eq(dailyTasks.groupId, current.group.id),
          eq(dailyTasks.memberId, current.member.id),
          eq(dailyTasks.reportDate, reportDate)
        ),
      });

      if (!todayTask?.id) {
        await this.answerCallbackQuery(query.id);
        await this.sendMessage(chatId, strings.no_daily_to_edit);
        return;
      }

      await this.answerCallbackQuery(query.id);

      if (data === CALLBACK_ACTIONS.EDIT_YESTERDAY) {
        this.editSessions.set(chatId, {
          step: 'waiting_yesterday',
          groupId: current.group.id,
          memberId: current.member.id,
          reportDate,
          isoDate,
        });
        await this.sendMessage(chatId, strings.edit_enter_yesterday, {
          parseMode: 'HTML',
          replyMarkup: getCancelButton(),
        });
      } else if (data === CALLBACK_ACTIONS.EDIT_TODAY) {
        this.editSessions.set(chatId, {
          step: 'waiting_today',
          groupId: current.group.id,
          memberId: current.member.id,
          reportDate,
          isoDate,
        });
        await this.sendMessage(chatId, strings.edit_enter_today, {
          parseMode: 'HTML',
          replyMarkup: getCancelButton(),
        });
      } else if (data === CALLBACK_ACTIONS.EDIT_BOTH) {
        this.editSessions.set(chatId, {
          step: 'waiting_both_yesterday',
          groupId: current.group.id,
          memberId: current.member.id,
          reportDate,
          isoDate,
        });
        await this.sendMessage(chatId, strings.edit_both_step1, {
          parseMode: 'HTML',
          replyMarkup: getCancelButton(),
        });
      }
    }
  }

  private static async handleLinkCode(
    chatId: string,
    senderTelegramId: string,
    senderUsername: string,
    code: string,
    threadId?: number | string
  ) {
    const entry = this.linkCodes.get(code);
    if (!entry || Date.now() > entry.expiresAt) {
      this.linkCodes.delete(code);
      await this.sendMessage(
        chatId,
        '❌ <b>Недействительный или истекший код привязки.</b> Сгенерируйте новый код в веб-интерфейсе.',
        { parseMode: 'HTML', messageThreadId: threadId }
      );
      return;
    }

    const userProf = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, entry.userId),
    });

    if (!userProf) {
      await this.sendMessage(chatId, '❌ <b>Профиль пользователя не найден.</b>', {
        parseMode: 'HTML',
        messageThreadId: threadId,
      });
      return;
    }

    const cleanUsername = senderUsername ? senderUsername.replace(/^@/, '') : userProf.username;
    const [updated] = await db
      .update(userProfiles)
      .set({
        telegramId: senderTelegramId,
        telegramChatId: chatId,
        username: cleanUsername || userProf.username,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userProfiles.id, entry.userId))
      .returning();

    this.linkCodes.delete(code);

    const { AuthService } = await import('../modules/auth/auth.service.js');
    if (updated) {
      await AuthService.syncMemberLinks(updated);
    }

    const name = userProf.firstName || userProf.username || userProf.email || 'Пользователь';
    await this.sendMessage(
      chatId,
      `🎉 <b>Аккаунт успешно привязан!</b>\n\n` +
        `Здравствуйте, <b>${this.escapeHtml(name)}</b>! Ваш веб-профиль Daily Service связан с вашим Telegram (@${this.escapeHtml(cleanUsername || senderTelegramId)}).\n\n` +
        `Теперь вы можете управлять своей группой и дейликами через веб-интерфейс и Telegram.`,
      { parseMode: 'HTML', messageThreadId: threadId }
    );
  }

  private static async handleInitCommand(
    chatId: string,
    chatTitle: string,
    isGroup: boolean,
    senderTelegramId: string,
    senderUsername: string,
    initCode?: string,
    threadId?: number | string
  ) {
    if (!isGroup) {
      await this.sendMessage(
        chatId,
        'ℹ️ Команда <code>/init</code> предназначена для инициализации бота внутри Telegram-группы. Добавьте бота в вашу группу и отправьте <code>/init</code> там.',
        { parseMode: 'HTML' }
      );
      return;
    }

    // 1. If initCode provided, match group with that initCode
    if (initCode) {
      const targetGroup = await db.query.groups.findFirst({
        where: eq(groups.initCode, initCode.trim()),
      });
      if (!targetGroup) {
        await this.sendMessage(
          chatId,
          '❌ <b>Группа с таким кодом инициализации не найдена.</b> Проверьте код в веб-интерфейсе.',
          { parseMode: 'HTML', messageThreadId: threadId }
        );
        return;
      }

      // Check if another group already uses this chatId
      const existingByChat = await db.query.groups.findFirst({
        where: eq(groups.chatId, chatId),
      });
      if (existingByChat && existingByChat.id !== targetGroup.id) {
        await this.sendMessage(
          chatId,
          `⚠️ Этот Telegram-чат уже привязан к другой группе («${this.escapeHtml(existingByChat.name)}»).`,
          { parseMode: 'HTML', messageThreadId: threadId }
        );
        return;
      }

      await db
        .update(groups)
        .set({
          chatId,
          threadId: threadId ? String(threadId) : null,
          name: targetGroup.name || chatTitle,
          initCode: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(groups.id, targetGroup.id));

      await this.sendMessage(
        chatId,
        `✅ <b>Группа «${this.escapeHtml(targetGroup.name)}» успешно привязана к этому чату!</b>\n\n` +
          `• Часовой пояс: <code>${targetGroup.timezone}</code>\n` +
          `• Напоминание в ЛС: <code>${targetGroup.privateRemindTime}</code>\n` +
          `• Напоминание в группу: <code>${targetGroup.publicRemindTime}</code>\n` +
          `• Отправка отчета в группу: <code>${targetGroup.groupReportTime}</code>`,
        { parseMode: 'HTML', messageThreadId: threadId }
      );
      return;
    }

    // 2. Without code: check if chatId is already initialized
    const existingGroup = await db.query.groups.findFirst({
      where: eq(groups.chatId, chatId),
    });
    if (existingGroup) {
      await this.sendMessage(
        chatId,
        `ℹ️ <b>Этот чат уже инициализирован как группа «${this.escapeHtml(existingGroup.name)}».</b>\n` +
          `Настроить участников и расписание можно в веб-интерфейсе Daily Service.`,
        { parseMode: 'HTML', messageThreadId: threadId }
      );
      return;
    }

    // Find sender's userProfile
    let userProf = senderTelegramId
      ? await db.query.userProfiles.findFirst({ where: eq(userProfiles.telegramId, senderTelegramId) })
      : null;

    if (!userProf && senderUsername) {
      userProf = sqlite
        .prepare(`SELECT * FROM user_profiles WHERE lower(username) = ? LIMIT 1`)
        .get(senderUsername.toLowerCase()) as any;
    }

    if (!userProf) {
      await this.sendMessage(
        chatId,
        `ℹ️ <b>Для инициализации группы сначала войдите в веб-интерфейс Daily Service</b> (через Telegram или Google) и нажмите «Создать / Подключить группу».\n\n` +
          `ID этого чата: <code>${chatId}</code>${threadId ? `\nThread ID: <code>${threadId}</code>` : ''}`,
        { parseMode: 'HTML', messageThreadId: threadId }
      );
      return;
    }

    // Check 1-admin-group-per-user limit
    const alreadyAdminGroup = await db.query.groups.findFirst({
      where: eq(groups.adminUserId, userProf.id),
    });

    if (alreadyAdminGroup) {
      // If their existing group doesn't have a chatId yet, bind it to this chat!
      if (!alreadyAdminGroup.chatId) {
        await db
          .update(groups)
          .set({
            chatId,
            threadId: threadId ? String(threadId) : null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(groups.id, alreadyAdminGroup.id));

        await this.sendMessage(
          chatId,
          `✅ <b>Ваша группа «${this.escapeHtml(alreadyAdminGroup.name)}» успешно привязана к этому Telegram-чату!</b>`,
          { parseMode: 'HTML', messageThreadId: threadId }
        );
        return;
      }

      await this.sendMessage(
        chatId,
        `⚠️ <b>Ограничение сервиса:</b> вы уже являетесь администратором группы «${this.escapeHtml(alreadyAdminGroup.name)}».\n` +
          `Один пользователь может быть администратором только в одной группе (и участником во многих группах).`,
        { parseMode: 'HTML', messageThreadId: threadId }
      );
      return;
    }

    // Create new group with this user as admin
    const now = new Date().toISOString();
    const newGroupId = crypto.randomUUID();
    await db.insert(groups).values({
      id: newGroupId,
      adminUserId: userProf.id,
      chatId,
      threadId: threadId ? String(threadId) : null,
      name: chatTitle || 'Моя команда',
      timezone: 'Asia/Bishkek',
      privateRemindTime: '16:30',
      isPrivateRemindEnabled: true,
      publicRemindTime: '09:10',
      isPublicRemindEnabled: true,
      groupReportTime: '09:15',
      isGroupReportEnabled: true,
      nextDayRolloverHour: 16,
      workDays: '1,2,3,4,5',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const cleanUsername = (senderUsername || userProf.username || `user_${senderTelegramId}`).replace(/^@/, '');
    await db.insert(groupMembers).values({
      id: crypto.randomUUID(),
      groupId: newGroupId,
      userProfileId: userProf.id,
      telegramUsername: cleanUsername,
      telegramId: senderTelegramId || userProf.telegramId || null,
      displayName: userProf.firstName || cleanUsername,
      role: 'admin',
      includeInDailies: false,
      canExportXlsx: true,
      isActive: true,
      createdAt: now,
    });

    await this.sendMessage(
      chatId,
      `🎉 <b>Группа «${this.escapeHtml(chatTitle)}» успешно инициализирована!</b>\n\n` +
        `👤 <b>Администратор:</b> @${this.escapeHtml(cleanUsername)}\n` +
        `⚙️ Теперь вы можете добавлять участников команды, настраивать расписание и выгружать отчеты в веб-интерфейсе Daily Service.`,
      { parseMode: 'HTML', messageThreadId: threadId }
    );
  }

  private static async pollUpdates() {
    while (this.isPolling) {
      try {
        const response = await fetch(`${this.getApiBase()}/getUpdates?offset=${this.offset}&timeout=20`);
        const data = (await response.json()) as any;

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            await this.processUpdate(update);
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error('[Telegram Bot] Ошибка long polling:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  public static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
