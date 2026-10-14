import { z } from 'zod';

export const UpsertDailySchema = z.object({
  groupId: z.string().min(1),
  yesterday: z.string().min(9, 'Минимум 9 символов').max(560, 'Максимум 560 символов'),
  today: z.string().min(9, 'Минимум 9 символов').max(560, 'Максимум 560 символов').optional().nullable(),
});

export const UpdateDailySchema = z.object({
  yesterday: z.string().min(9, 'Минимум 9 символов').max(560, 'Максимум 560 символов').optional(),
  today: z.string().min(9, 'Минимум 9 символов').max(560, 'Максимум 560 символов').optional().nullable(),
});

export const SetActiveGroupSchema = z.object({
  groupId: z.string().min(1),
});
