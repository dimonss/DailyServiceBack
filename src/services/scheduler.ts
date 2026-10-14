import cron from 'node-cron';
import { db } from '../db/connection.js';
import { groups } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getLocalDateParts, parseWorkDays } from '../utils/dateUtils.js';
import { TelegramBotService } from './telegramBot.js';

const executedJobs = new Set<string>();

export const startScheduler = () => {
  // Run every minute and evaluate each active group's schedule in its own timezone
  cron.schedule('* * * * *', async () => {
    try {
      const activeGroups = await db.query.groups.findMany({
        where: eq(groups.isActive, true),
      });

      const now = new Date();

      for (const group of activeGroups) {
        if (!group.chatId) continue;

        const parts = getLocalDateParts(now, group.timezone);
        const workDays = parseWorkDays(group.workDays);

        if (!workDays.includes(parts.weekdayIso)) {
          continue;
        }

        const currentHHMM = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
        const dateKey = `${parts.year}-${parts.month}-${parts.day}`;

        // 1. Private Remind
        if (group.isPrivateRemindEnabled && group.privateRemindTime === currentHHMM) {
          const jobKey = `${group.id}:private:${dateKey}:${currentHHMM}`;
          if (!executedJobs.has(jobKey)) {
            executedJobs.add(jobKey);
            console.log(`[Scheduler] Running dailyPrivateRemind for group "${group.name}" (${group.id})`);
            TelegramBotService.runDailyPrivateRemind(group.id).catch((err) =>
              console.error('[Scheduler] dailyPrivateRemind error:', err)
            );
          }
        }

        // 2. Public Remind
        if (group.isPublicRemindEnabled && group.publicRemindTime === currentHHMM) {
          const jobKey = `${group.id}:public:${dateKey}:${currentHHMM}`;
          if (!executedJobs.has(jobKey)) {
            executedJobs.add(jobKey);
            console.log(`[Scheduler] Running dailyPublicRemind for group "${group.name}" (${group.id})`);
            TelegramBotService.runDailyPublicRemind(group.id).catch((err) =>
              console.error('[Scheduler] dailyPublicRemind error:', err)
            );
          }
        }

        // 3. Group Report
        if (group.isGroupReportEnabled && group.groupReportTime === currentHHMM) {
          const jobKey = `${group.id}:report:${dateKey}:${currentHHMM}`;
          if (!executedJobs.has(jobKey)) {
            executedJobs.add(jobKey);
            console.log(`[Scheduler] Running dailyGroupReport for group "${group.name}" (${group.id})`);
            TelegramBotService.runDailyGroupReport(group.id).catch((err) =>
              console.error('[Scheduler] dailyGroupReport error:', err)
            );
          }
        }
      }

      // Prevent unbounded memory growth of executedJobs
      if (executedJobs.size > 5000) {
        executedJobs.clear();
      }
    } catch (error) {
      console.error('[Scheduler] Tick error:', error);
    }
  });

  console.log('[Scheduler] Multi-group timezone-aware scheduler started.');
};
