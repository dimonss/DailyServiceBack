import { z } from 'zod';

export const TelegramAuthSchema = z.object({
  id: z.union([z.number(), z.string()]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string(),
});

export const GoogleAuthSchema = z.object({
  credential: z.string().optional(),
  idToken: z.string().optional(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});
