import { db } from '../../db/connection.js';
import { dailyTasks, groupMembers, groups, userProfiles } from '../../db/schema.js';
import { eq, and, desc, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { getIsoDateDaysAgo, getReportingDateInfo, isGroupReportTimePassed } from '../../utils/dateUtils.js';
import { GroupsService } from '../groups/groups.service.js';

export class DailiesService {
  static async getUserMemberIds(user: typeof userProfiles.$inferSelect): Promise<string[]> {
    const allMembers = await db.query.groupMembers.findMany();
    const cleanUsername = user.username ? user.username.replace(/^@/, '').toLowerCase() : '';
    return allMembers
      .filter((m) => {
        if (m.userProfileId === user.id) return true;
        if (user.telegramId && m.telegramId === user.telegramId) return true;
        if (cleanUsername && m.telegramUsername.toLowerCase() === cleanUsername) return true;
        return false;
      })
      .map((m) => m.id);
  }

  static async getMyDailies(
    user: typeof userProfiles.$inferSelect,
    query: { groupId?: string; period?: string; search?: string }
  ) {
    const memberIds = await this.getUserMemberIds(user);
    if (memberIds.length === 0) {
      return [];
    }

    const tasks = await db.query.dailyTasks.findMany({
      where: inArray(dailyTasks.memberId, memberIds),
      orderBy: [desc(dailyTasks.isoDate), desc(dailyTasks.updatedAt)],
    });

    const allGroups = await db.query.groups.findMany();
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));

    const allMembers = await db.query.groupMembers.findMany({
      where: inArray(groupMembers.id, memberIds),
    });
    const memberMap = new Map(allMembers.map((m) => [m.id, m]));

    let filtered = tasks;

    if (query.groupId) {
      filtered = filtered.filter((t) => t.groupId === query.groupId);
    }

    if (query.period === 'week') {
      const startIso = getIsoDateDaysAgo(7);
      filtered = filtered.filter((t) => t.isoDate >= startIso);
    } else if (query.period === 'month') {
      const startIso = getIsoDateDaysAgo(30);
      filtered = filtered.filter((t) => t.isoDate >= startIso);
    } else if (query.period === 'today') {
      filtered = filtered.filter((t) => {
        const grp = groupMap.get(t.groupId);
        const { reportDate } = getReportingDateInfo(grp);
        return t.reportDate === reportDate;
      });
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.yesterday.toLowerCase().includes(q) ||
          (t.today && t.today.toLowerCase().includes(q)) ||
          t.reportDate.includes(q)
      );
    }

    return filtered.map((t) => {
      const grp = groupMap.get(t.groupId);
      const mem = memberMap.get(t.memberId);
      const { reportDate: currentReportDate } = getReportingDateInfo(grp);
      const isToday = t.reportDate === currentReportDate;
      const canEdit = isToday && (!grp || !isGroupReportTimePassed(grp) || grp.adminUserId === user.id);

      return {
        ...t,
        groupName: grp?.name || 'Группа',
        displayName: mem?.displayName || t.telegramUsername,
        isToday,
        canEdit,
      };
    });
  }

  static async getGroupDailies(
    groupId: string,
    user: typeof userProfiles.$inferSelect,
    query: { period?: string; memberId?: string; reportDate?: string; search?: string }
  ) {
    const { group, isAdmin } = await GroupsService.verifyGroupAccess(groupId, user);
    const { reportDate: currentReportDate } = getReportingDateInfo(group);

    const tasks = await db.query.dailyTasks.findMany({
      where: eq(dailyTasks.groupId, groupId),
      orderBy: [desc(dailyTasks.isoDate), desc(dailyTasks.updatedAt)],
    });

    const members = await db.query.groupMembers.findMany({
      where: eq(groupMembers.groupId, groupId),
    });
    const memberMap = new Map(members.map((m) => [m.id, m]));

    let filtered = tasks;

    if (query.memberId) {
      filtered = filtered.filter((t) => t.memberId === query.memberId);
    }
    if (query.reportDate) {
      filtered = filtered.filter((t) => t.reportDate === query.reportDate);
    } else if (query.period === 'today') {
      filtered = filtered.filter((t) => t.reportDate === currentReportDate);
    } else if (query.period === 'week') {
      const startIso = getIsoDateDaysAgo(7, group.timezone);
      filtered = filtered.filter((t) => t.isoDate >= startIso);
    } else if (query.period === 'month') {
      const startIso = getIsoDateDaysAgo(30, group.timezone);
      filtered = filtered.filter((t) => t.isoDate >= startIso);
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      filtered = filtered.filter((t) => {
        const mem = memberMap.get(t.memberId);
        return (
          t.yesterday.toLowerCase().includes(q) ||
          (t.today && t.today.toLowerCase().includes(q)) ||
          t.telegramUsername.toLowerCase().includes(q) ||
          (mem?.displayName && mem.displayName.toLowerCase().includes(q)) ||
          t.reportDate.includes(q)
        );
      });
    }

    return filtered.map((t) => {
      const mem = memberMap.get(t.memberId);
      const isToday = t.reportDate === currentReportDate;
      const isOwn = mem?.userProfileId === user.id || (user.username && t.telegramUsername.toLowerCase() === user.username.toLowerCase());
      const canEdit = isAdmin || (isOwn && isToday && !isGroupReportTimePassed(group));

      return {
        ...t,
        displayName: mem?.displayName || t.telegramUsername,
        memberRole: mem?.role || 'member',
        isToday,
        canEdit,
      };
    });
  }

  static async upsertTodayDaily(
    user: typeof userProfiles.$inferSelect,
    data: { groupId: string; yesterday: string; today?: string | null }
  ) {
    const { group, isAdmin, member } = await GroupsService.verifyGroupAccess(data.groupId, user);

    let targetMember = member;
    if (!targetMember && isAdmin) {
      const members = await db.query.groupMembers.findMany({
        where: eq(groupMembers.groupId, group.id),
      });
      const cleanUsername = user.username ? user.username.replace(/^@/, '').toLowerCase() : '';
      targetMember =
        members.find(
          (m) =>
            m.userProfileId === user.id ||
            (cleanUsername && m.telegramUsername.toLowerCase() === cleanUsername)
        ) || null;
    }

    if (!targetMember) {
      throw new Error('Вы не являетесь участником этой группы');
    }

    if (!isAdmin && isGroupReportTimePassed(group)) {
      throw new Error('Нельзя изменять или отправлять дейлик после отправки отчета в группу');
    }

    const { reportDate, isoDate } = getReportingDateInfo(group);
    const existing = await db.query.dailyTasks.findFirst({
      where: and(
        eq(dailyTasks.groupId, group.id),
        eq(dailyTasks.memberId, targetMember.id),
        eq(dailyTasks.reportDate, reportDate)
      ),
    });

    const now = new Date().toISOString();

    if (existing) {
      const [updated] = await db
        .update(dailyTasks)
        .set({
          yesterday: data.yesterday.trim(),
          today: data.today !== undefined ? (data.today ? data.today.trim() : null) : existing.today,
          userProfileId: user.id,
          updatedAt: now,
        })
        .where(eq(dailyTasks.id, existing.id))
        .returning();
      return updated;
    } else {
      const [inserted] = await db
        .insert(dailyTasks)
        .values({
          id: crypto.randomUUID(),
          groupId: group.id,
          memberId: targetMember.id,
          userProfileId: user.id,
          telegramUsername: targetMember.telegramUsername,
          yesterday: data.yesterday.trim(),
          today: data.today ? data.today.trim() : null,
          reportDate,
          isoDate,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted;
    }
  }

  static async updateDailyById(
    taskId: string,
    user: typeof userProfiles.$inferSelect,
    data: { yesterday?: string; today?: string | null }
  ) {
    const task = await db.query.dailyTasks.findFirst({
      where: eq(dailyTasks.id, taskId),
    });
    if (!task) {
      throw new Error('Дейлик не найден');
    }

    const { group, isAdmin, member } = await GroupsService.verifyGroupAccess(task.groupId, user);
    const isOwn =
      task.userProfileId === user.id ||
      (member && task.memberId === member.id) ||
      (user.username && task.telegramUsername.toLowerCase() === user.username.toLowerCase());

    if (!isAdmin && !isOwn) {
      throw new Error('Нет прав для редактирования чужого дейлика');
    }

    const { reportDate } = getReportingDateInfo(group);
    if (!isAdmin && (task.reportDate !== reportDate || isGroupReportTimePassed(group))) {
      throw new Error('Нельзя редактировать дейлик после отправки отчета в группу');
    }

    const updates: any = { updatedAt: new Date().toISOString() };
    if (data.yesterday !== undefined) updates.yesterday = data.yesterday.trim();
    if (data.today !== undefined) updates.today = data.today ? data.today.trim() : null;

    const [updated] = await db
      .update(dailyTasks)
      .set(updates)
      .where(eq(dailyTasks.id, taskId))
      .returning();

    return updated;
  }

  static async deleteDailyById(taskId: string, user: typeof userProfiles.$inferSelect) {
    const task = await db.query.dailyTasks.findFirst({
      where: eq(dailyTasks.id, taskId),
    });
    if (!task) {
      throw new Error('Дейлик не найден');
    }

    const { group, isAdmin, member } = await GroupsService.verifyGroupAccess(task.groupId, user);
    const isOwn =
      task.userProfileId === user.id ||
      (member && task.memberId === member.id) ||
      (user.username && task.telegramUsername.toLowerCase() === user.username.toLowerCase());

    if (!isAdmin && !isOwn) {
      throw new Error('Нет прав для удаления чужого дейлика');
    }

    const { reportDate } = getReportingDateInfo(group);
    if (!isAdmin && (task.reportDate !== reportDate || isGroupReportTimePassed(group))) {
      throw new Error('Нельзя удалить дейлик после отправки отчета в группу');
    }

    await db.delete(dailyTasks).where(eq(dailyTasks.id, taskId));
    return { deleted: true };
  }
}
