import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  chatId: z.string().optional().nullable(),
  threadId: z.string().optional().nullable(),
  timezone: z.string().default('Asia/Bishkek'),
  privateRemindTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').default('16:30'),
  isPrivateRemindEnabled: z.boolean().default(true),
  publicRemindTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').default('09:10'),
  isPublicRemindEnabled: z.boolean().default(true),
  groupReportTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').default('09:15'),
  isGroupReportEnabled: z.boolean().default(true),
  nextDayRolloverHour: z.number().int().min(0).max(23).default(16),
  workDays: z.string().default('1,2,3,4,5'),
  includeAdminInDailies: z.boolean().optional().default(false),
});

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  chatId: z.string().optional().nullable(),
  threadId: z.string().optional().nullable(),
  timezone: z.string().optional(),
  privateRemindTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').optional(),
  isPrivateRemindEnabled: z.boolean().optional(),
  publicRemindTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').optional(),
  isPublicRemindEnabled: z.boolean().optional(),
  groupReportTime: z.string().regex(timeRegex, 'Формат ЧЧ:ММ').optional(),
  isGroupReportEnabled: z.boolean().optional(),
  nextDayRolloverHour: z.number().int().min(0).max(23).optional(),
  workDays: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const AddGroupMemberSchema = z.object({
  telegramUsername: z.string().min(1).max(64),
  displayName: z.string().min(1).max(100),
  role: z.enum(['admin', 'member', 'export_only']).default('member'),
  includeInDailies: z.boolean().default(true),
  canExportXlsx: z.boolean().default(false),
});

export const BulkImportMembersSchema = z.object({
  availableUsers: z.string().min(1), // e.g. "DiChDev|dmman171|DiChLtd"
  availableUsersNames: z.string().optional(), // e.g. "Лид|Дима|ЛимТестовый"
  exportXlsxUsers: z.string().optional(), // e.g. "DiChDev|dmman171"
});

export const UpdateGroupMemberSchema = z.object({
  telegramUsername: z.string().min(1).max(64).optional(),
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'member', 'export_only']).optional(),
  includeInDailies: z.boolean().optional(),
  canExportXlsx: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
