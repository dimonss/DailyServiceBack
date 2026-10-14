import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(),
  authUserId: text('auth_user_id').notNull().unique(),
  telegramId: text('telegram_id'),
  telegramChatId: text('telegram_chat_id'),
  googleId: text('google_id'),
  email: text('email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username'),
  photoUrl: text('photo_url'),
  activeGroupId: text('active_group_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  adminUserId: text('admin_user_id').notNull().unique().references(() => userProfiles.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').unique(),
  threadId: text('thread_id'),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Bishkek'),
  privateRemindTime: text('private_remind_time').notNull().default('16:30'),
  isPrivateRemindEnabled: integer('is_private_remind_enabled', { mode: 'boolean' }).notNull().default(true),
  publicRemindTime: text('public_remind_time').notNull().default('09:10'),
  isPublicRemindEnabled: integer('is_public_remind_enabled', { mode: 'boolean' }).notNull().default(true),
  groupReportTime: text('group_report_time').notNull().default('09:15'),
  isGroupReportEnabled: integer('is_group_report_enabled', { mode: 'boolean' }).notNull().default(true),
  nextDayRolloverHour: integer('next_day_rollover_hour').notNull().default(16),
  workDays: text('work_days').notNull().default('1,2,3,4,5'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  initCode: text('init_code'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const groupMembers = sqliteTable('group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  userProfileId: text('user_profile_id').references(() => userProfiles.id, { onDelete: 'set null' }),
  telegramUsername: text('telegram_username').notNull(),
  telegramId: text('telegram_id'),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member' | 'export_only'
  includeInDailies: integer('include_in_dailies', { mode: 'boolean' }).notNull().default(true),
  canExportXlsx: integer('can_export_xlsx', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const dailyTasks = sqliteTable('daily_tasks', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => groupMembers.id, { onDelete: 'cascade' }),
  userProfileId: text('user_profile_id').references(() => userProfiles.id, { onDelete: 'set null' }),
  telegramUsername: text('telegram_username').notNull(),
  yesterday: text('yesterday').notNull(),
  today: text('today'),
  reportDate: text('report_date').notNull(), // D.M.YYYY (teamReminderBot compatible)
  isoDate: text('iso_date').notNull(), // YYYY-MM-DD (for sorting & date range filtering)
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const telegramChats = sqliteTable('telegram_chats', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull().unique(),
  threadId: text('thread_id'),
  title: text('title'),
  type: text('type').notNull(), // 'private' | 'group' | 'supergroup'
  registeredByTelegramId: text('registered_by_telegram_id'),
  registeredByUsername: text('registered_by_username'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});
