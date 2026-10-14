import { db, sqlite } from '../../db/connection.js';
import { groups, groupMembers, dailyTasks, userProfiles } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { getReportingDateInfo, isGroupReportTimePassed } from '../../utils/dateUtils.js';
import { TelegramBotService } from '../../services/telegramBot.js';

export class GroupsService {
  private static generateInitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  static async enrichGroupWithTodayStats(group: typeof groups.$inferSelect) {
    const members = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, group.id),
    });

    const { reportDate, isoDate } = getReportingDateInfo(group);
    const isCutoffPassed = isGroupReportTimePassed(group);

    const todayTasks = await db.query.dailyTasks.findMany({
      where: and(eq(dailyTasks.groupId, group.id), eq(dailyTasks.reportDate, reportDate)),
    });

    const taskByMemberId = new Map(todayTasks.map((t) => [t.memberId, t]));

    const enrichedMembers = members.map((m) => {
      const task = taskByMemberId.get(m.id) || null;
      let todayStatus: 'submitted' | 'partial' | 'missing' | 'exempt' = 'missing';
      if (!m.includeInDailies || m.role === 'export_only' || !m.isActive) {
        todayStatus = task?.today ? 'submitted' : task?.yesterday ? 'partial' : 'exempt';
      } else if (task?.yesterday && task?.today) {
        todayStatus = 'submitted';
      } else if (task?.yesterday) {
        todayStatus = 'partial';
      } else {
        todayStatus = 'missing';
      }

      return {
        ...m,
        todayStatus,
        todayTask: task,
      };
    });

    const requiredMembers = enrichedMembers.filter(
      (m) => m.isActive && m.includeInDailies && m.role !== 'export_only'
    );
    const submittedCount = requiredMembers.filter((m) => m.todayStatus === 'submitted').length;
    const partialCount = requiredMembers.filter((m) => m.todayStatus === 'partial').length;
    const missingCount = requiredMembers.filter((m) => m.todayStatus === 'missing').length;

    return {
      ...group,
      reportDate,
      isoDate,
      isCutoffPassed,
      members: enrichedMembers,
      stats: {
        totalMembers: members.length,
        requiredCount: requiredMembers.length,
        submittedCount,
        partialCount,
        missingCount,
      },
    };
  }

  static async getUserGroupsOverview(user: typeof userProfiles.$inferSelect) {
    // 1. Find group where user is Admin (max 1)
    const adminGroupRaw = await db.query.groups.findFirst({
      where: eq(groups.adminUserId, user.id),
    });

    const adminGroup = adminGroupRaw ? await this.enrichGroupWithTodayStats(adminGroupRaw) : null;

    // 2. Find all groups where user is a member
    const allMembers = await db.query.groupMembers.findMany({
      where: eq(groupMembers.isActive, true),
    });

    const cleanUsername = user.username ? user.username.replace(/^@/, '').toLowerCase() : '';
    const myMemberRecords = allMembers.filter((m) => {
      if (m.userProfileId === user.id) return true;
      if (user.telegramId && m.telegramId === user.telegramId) return true;
      if (cleanUsername && m.telegramUsername.toLowerCase() === cleanUsername) return true;
      return false;
    });

    const memberGroups = [];
    for (const memberRecord of myMemberRecords) {
      const grp = await db.query.groups.findFirst({
        where: eq(groups.id, memberRecord.groupId),
      });
      if (!grp) continue;

      const { reportDate, isoDate } = getReportingDateInfo(grp);
      const isCutoffPassed = isGroupReportTimePassed(grp);
      const myTodayTask = await db.query.dailyTasks.findFirst({
        where: and(
          eq(dailyTasks.groupId, grp.id),
          eq(dailyTasks.memberId, memberRecord.id),
          eq(dailyTasks.reportDate, reportDate)
        ),
      });

      const groupMembersCount = allMembers.filter((m) => m.groupId === grp.id).length;

      memberGroups.push({
        group: grp,
        membership: memberRecord,
        isAdmin: grp.adminUserId === user.id || memberRecord.role === 'admin',
        reportDate,
        isoDate,
        isCutoffPassed,
        myTodayTask: myTodayTask || null,
        membersCount: groupMembersCount,
      });
    }

    return {
      adminGroup,
      memberGroups,
      canCreateAdminGroup: !adminGroup,
      botUsername: TelegramBotService.getBotUsername(),
    };
  }

  static async createAdminGroup(user: typeof userProfiles.$inferSelect, data: any) {
    // Enforce: 1 Admin group per user ("админ в одном месте")
    const existingAdminGroup = await db.query.groups.findFirst({
      where: eq(groups.adminUserId, user.id),
    });

    if (existingAdminGroup) {
      throw new Error(
        `Вы уже являетесь администратором группы «${existingAdminGroup.name}». По правилам сервиса один пользователь может быть администратором только в одной группе (и участником во многих).`
      );
    }

    const cleanChatId = data.chatId ? String(data.chatId).trim() : null;
    if (cleanChatId) {
      const existingByChat = await db.query.groups.findFirst({
        where: eq(groups.chatId, cleanChatId),
      });
      if (existingByChat) {
        throw new Error(`Этот Telegram чат (${cleanChatId}) уже привязан к другой группе.`);
      }
    }

    const now = new Date().toISOString();
    const groupId = crypto.randomUUID();
    const initCode = cleanChatId ? null : this.generateInitCode();

    const [createdGroup] = await db
      .insert(groups)
      .values({
        id: groupId,
        adminUserId: user.id,
        chatId: cleanChatId || null,
        threadId: data.threadId ? String(data.threadId).trim() : null,
        name: data.name.trim(),
        timezone: data.timezone || 'Asia/Bishkek',
        privateRemindTime: data.privateRemindTime || '16:30',
        isPrivateRemindEnabled: data.isPrivateRemindEnabled ?? true,
        publicRemindTime: data.publicRemindTime || '09:10',
        isPublicRemindEnabled: data.isPublicRemindEnabled ?? true,
        groupReportTime: data.groupReportTime || '09:15',
        isGroupReportEnabled: data.isGroupReportEnabled ?? true,
        nextDayRolloverHour: data.nextDayRolloverHour ?? 16,
        workDays: data.workDays || '1,2,3,4,5',
        isActive: true,
        initCode,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Automatically add the admin as a member in group_members
    const adminUsername = (
      user.username ||
      (user.email ? user.email.split('@')[0] : null) ||
      `admin_${user.id.slice(0, 6)}`
    ).replace(/^@/, '');

    const adminDisplayName = user.firstName || adminUsername;

    await db.insert(groupMembers).values({
      id: crypto.randomUUID(),
      groupId,
      userProfileId: user.id,
      telegramUsername: adminUsername,
      telegramId: user.telegramId || null,
      displayName: adminDisplayName,
      role: 'admin',
      includeInDailies: data.includeAdminInDailies ?? false,
      canExportXlsx: true,
      isActive: true,
      createdAt: now,
    });

    return this.enrichGroupWithTodayStats(createdGroup);
  }

  static async verifyGroupAdmin(groupId: string, userId: string) {
    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
    });
    if (!group) {
      throw new Error('Группа не найдена');
    }
    if (group.adminUserId !== userId) {
      throw new Error('Только администратор группы может выполнять это действие');
    }
    return group;
  }

  static async verifyGroupAccess(groupId: string, user: typeof userProfiles.$inferSelect) {
    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
    });
    if (!group) {
      throw new Error('Группа не найдена');
    }
    if (group.adminUserId === user.id) {
      return { group, isAdmin: true, member: null };
    }

    const members = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, groupId),
    });
    const cleanUsername = user.username ? user.username.replace(/^@/, '').toLowerCase() : '';
    const member = members.find(
      (m) =>
        m.userProfileId === user.id ||
        (user.telegramId && m.telegramId === user.telegramId) ||
        (cleanUsername && m.telegramUsername.toLowerCase() === cleanUsername)
    );

    if (!member) {
      throw new Error('У вас нет доступа к этой группе');
    }

    return { group, isAdmin: member.role === 'admin', member };
  }

  static async updateGroup(groupId: string, userId: string, data: any) {
    const group = await this.verifyGroupAdmin(groupId, userId);

    const updates: any = { updatedAt: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.chatId !== undefined) {
      const cleanChatId = data.chatId ? String(data.chatId).trim() : null;
      if (cleanChatId && cleanChatId !== group.chatId) {
        const existingByChat = await db.query.groups.findFirst({
          where: eq(groups.chatId, cleanChatId),
        });
        if (existingByChat && existingByChat.id !== groupId) {
          throw new Error(`Чат ${cleanChatId} уже привязан к другой группе`);
        }
      }
      updates.chatId = cleanChatId;
      if (cleanChatId) updates.initCode = null;
    }
    if (data.threadId !== undefined) {
      updates.threadId = data.threadId ? String(data.threadId).trim() : null;
    }
    if (data.timezone !== undefined) updates.timezone = data.timezone;
    if (data.privateRemindTime !== undefined) updates.privateRemindTime = data.privateRemindTime;
    if (data.isPrivateRemindEnabled !== undefined) updates.isPrivateRemindEnabled = data.isPrivateRemindEnabled;
    if (data.publicRemindTime !== undefined) updates.publicRemindTime = data.publicRemindTime;
    if (data.isPublicRemindEnabled !== undefined) updates.isPublicRemindEnabled = data.isPublicRemindEnabled;
    if (data.groupReportTime !== undefined) updates.groupReportTime = data.groupReportTime;
    if (data.isGroupReportEnabled !== undefined) updates.isGroupReportEnabled = data.isGroupReportEnabled;
    if (data.nextDayRolloverHour !== undefined) updates.nextDayRolloverHour = data.nextDayRolloverHour;
    if (data.workDays !== undefined) updates.workDays = data.workDays;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    const [updated] = await db.update(groups).set(updates).where(eq(groups.id, groupId)).returning();
    return this.enrichGroupWithTodayStats(updated);
  }

  static async regenerateInitCode(groupId: string, userId: string) {
    await this.verifyGroupAdmin(groupId, userId);
    const initCode = this.generateInitCode();
    const [updated] = await db
      .update(groups)
      .set({ initCode, updatedAt: new Date().toISOString() })
      .where(eq(groups.id, groupId))
      .returning();
    return {
      initCode: updated.initCode,
      botUsername: TelegramBotService.getBotUsername(),
    };
  }

  static async deleteGroup(groupId: string, userId: string) {
    await this.verifyGroupAdmin(groupId, userId);
    await db.delete(groups).where(eq(groups.id, groupId));
    return { deleted: true };
  }

  static async addMember(groupId: string, userId: string, data: any) {
    await this.verifyGroupAdmin(groupId, userId);
    const cleanUsername = data.telegramUsername.replace(/^@/, '').trim();
    if (!cleanUsername) {
      throw new Error('Укажите корректный Telegram username');
    }

    const existingMembers = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, groupId),
    });
    if (existingMembers.some((m) => m.telegramUsername.toLowerCase() === cleanUsername.toLowerCase())) {
      throw new Error(`Пользователь @${cleanUsername} уже состоит в этой группе`);
    }

    // Check if there is an existing userProfile with this username
    const matchedProfile = sqlite
      .prepare(`SELECT * FROM user_profiles WHERE lower(username) = ? LIMIT 1`)
      .get(cleanUsername.toLowerCase()) as any;

    const [inserted] = await db
      .insert(groupMembers)
      .values({
        id: crypto.randomUUID(),
        groupId,
        userProfileId: matchedProfile?.id || null,
        telegramUsername: cleanUsername,
        telegramId: matchedProfile?.telegram_id || null,
        displayName: data.displayName.trim() || cleanUsername,
        role: data.role || 'member',
        includeInDailies: data.role === 'export_only' ? false : (data.includeInDailies ?? true),
        canExportXlsx: data.role === 'admin' || data.role === 'export_only' ? true : (data.canExportXlsx ?? false),
        isActive: true,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return inserted;
  }

  static async bulkImportMembers(
    groupId: string,
    userId: string,
    data: { availableUsers: string; availableUsersNames?: string; exportXlsxUsers?: string }
  ) {
    await this.verifyGroupAdmin(groupId, userId);

    const usernames = data.availableUsers
      .split('|')
      .map((u) => u.replace(/^@/, '').trim())
      .filter(Boolean);
    const names = (data.availableUsersNames || '')
      .split('|')
      .map((n) => n.trim());
    const exportUsers = new Set(
      (data.exportXlsxUsers || '')
        .split('|')
        .map((u) => u.replace(/^@/, '').trim().toLowerCase())
        .filter(Boolean)
    );

    const existingMembers = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, groupId),
    });
    const existingSet = new Set(existingMembers.map((m) => m.telegramUsername.toLowerCase()));

    const added = [];
    for (let i = 0; i < usernames.length; i++) {
      const uname = usernames[i];
      if (existingSet.has(uname.toLowerCase())) continue;

      const displayName = names[i] || uname;
      const canExport = exportUsers.has(uname.toLowerCase());
      const member = await this.addMember(groupId, userId, {
        telegramUsername: uname,
        displayName,
        role: 'member',
        includeInDailies: true,
        canExportXlsx: canExport,
      });
      existingSet.add(uname.toLowerCase());
      added.push(member);
    }

    // Also add export-only users that were not in availableUsers
    for (const expUser of exportUsers) {
      if (!existingSet.has(expUser)) {
        const member = await this.addMember(groupId, userId, {
          telegramUsername: expUser,
          displayName: expUser,
          role: 'export_only',
          includeInDailies: false,
          canExportXlsx: true,
        });
        existingSet.add(expUser);
        added.push(member);
      }
    }

    return added;
  }

  static async updateMember(groupId: string, memberId: string, userId: string, data: any) {
    await this.verifyGroupAdmin(groupId, userId);

    const updates: any = {};
    if (data.telegramUsername !== undefined) {
      updates.telegramUsername = data.telegramUsername.replace(/^@/, '').trim();
    }
    if (data.displayName !== undefined) {
      updates.displayName = data.displayName.trim();
    }
    if (data.role !== undefined) {
      updates.role = data.role;
      if (data.role === 'export_only') {
        updates.includeInDailies = false;
        updates.canExportXlsx = true;
      }
    }
    if (data.includeInDailies !== undefined) updates.includeInDailies = data.includeInDailies;
    if (data.canExportXlsx !== undefined) updates.canExportXlsx = data.canExportXlsx;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    const [updated] = await db
      .update(groupMembers)
      .set(updates)
      .where(and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)))
      .returning();

    return updated;
  }

  static async removeMember(groupId: string, memberId: string, userId: string) {
    await this.verifyGroupAdmin(groupId, userId);
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)));
    return { deleted: true };
  }
}
