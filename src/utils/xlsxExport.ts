import * as XLSX from 'xlsx';
import { db } from '../db/connection.js';
import { dailyTasks, groupMembers, groups } from '../db/schema.js';
import { eq, and, gte, desc } from 'drizzle-orm';
import { getIsoDateDaysAgo, getReportingDateInfo } from './dateUtils.js';

export type ExportPeriod = 'all' | 'month' | 'week';

export const generateGroupXlsxBuffer = async (
  groupId: string,
  period: ExportPeriod = 'all'
): Promise<{ buffer: Buffer; filename: string }> => {
  const group = await db.query.groups.findFirst({
    where: eq(groups.id, groupId),
  });

  const tz = group?.timezone || 'Asia/Bishkek';
  const { reportDate } = getReportingDateInfo(group || undefined);

  let whereCond: any = eq(dailyTasks.groupId, groupId);
  if (period === 'week') {
    const startIso = getIsoDateDaysAgo(7, tz);
    whereCond = and(eq(dailyTasks.groupId, groupId), gte(dailyTasks.isoDate, startIso));
  } else if (period === 'month') {
    const startIso = getIsoDateDaysAgo(30, tz);
    whereCond = and(eq(dailyTasks.groupId, groupId), gte(dailyTasks.isoDate, startIso));
  }

  const tasks = await db.query.dailyTasks.findMany({
    where: whereCond,
    orderBy: [desc(dailyTasks.isoDate), desc(dailyTasks.createdAt)],
  });

  const members = await db.query.groupMembers.findMany({
    where: eq(groupMembers.groupId, groupId),
  });

  const memberMap = new Map(members.map((m) => [m.id, m]));
  const usernameMap = new Map(members.map((m) => [m.telegramUsername.toLowerCase(), m]));

  const rows = tasks.map((item, idx) => {
    const member =
      memberMap.get(item.memberId) ||
      usernameMap.get(item.telegramUsername.toLowerCase());

    return {
      id: idx + 1,
      userId: item.memberId,
      username: item.telegramUsername,
      userCyrillicName: member?.displayName || item.telegramUsername,
      yesterday: item.yesterday,
      today: item.today || '',
      date: item.reportDate,
    };
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            id: '',
            userId: '',
            username: '',
            userCyrillicName: '',
            yesterday: '',
            today: '',
            date: '',
          },
        ]
  );

  // Set readable column widths
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 20 },
    { wch: 22 },
    { wch: 50 },
    { wch: 50 },
    { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Users and Tasks');

  const arrayBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const buffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer);

  const prefix =
    period === 'week'
      ? 'team_tasks_last_week'
      : period === 'month'
        ? 'team_tasks_last_month'
        : 'team_tasks';

  const filename = `${prefix}_${reportDate}.xlsx`;

  return { buffer, filename };
};
