import { db, sqlite } from '../../db/connection.js';
import { userProfiles } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3000/auth/api';

export class AuthService {
  static async loginTelegram(data: any) {
    const res = await fetch(`${AUTH_URL}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    const authData = (await res.json()) as any;
    const localUser = await this.upsertUserProfile(authData.user);
    return { ...authData, user: localUser };
  }

  static async loginGoogle(data: { credential?: string; idToken?: string }) {
    const idToken = data.idToken || data.credential;
    const res = await fetch(`${AUTH_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) throw new Error(await res.text());
    const authData = (await res.json()) as any;
    const localUser = await this.upsertUserProfile(authData.user);
    return { ...authData, user: localUser };
  }

  static async refreshTokens(token: string) {
    const res = await fetch(`${AUTH_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  static async logout(token: string) {
    const res = await fetch(`${AUTH_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  static async getUserProfile(authUserId: string) {
    return db.query.userProfiles.findFirst({
      where: eq(userProfiles.authUserId, authUserId),
    });
  }

  static async fetchAndSaveUserProfile(token: string) {
    const res = await fetch(`${AUTH_URL}/user/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    const userData = await res.json();
    return this.upsertUserProfile(userData);
  }

  static async syncMemberLinks(user: typeof userProfiles.$inferSelect) {
    try {
      if (user.username) {
        const cleanUsername = user.username.replace(/^@/, '').trim().toLowerCase();
        if (cleanUsername) {
          sqlite
            .prepare(
              `UPDATE group_members
               SET user_profile_id = ?, telegram_id = COALESCE(telegram_id, ?)
               WHERE lower(telegram_username) = ? AND (user_profile_id IS NULL OR user_profile_id != ?)`
            )
            .run(user.id, user.telegramId || null, cleanUsername, user.id);

          sqlite
            .prepare(
              `UPDATE daily_tasks
               SET user_profile_id = ?
               WHERE lower(telegram_username) = ? AND (user_profile_id IS NULL OR user_profile_id != ?)`
            )
            .run(user.id, cleanUsername, user.id);
        }
      }

      if (user.telegramId) {
        sqlite
          .prepare(
            `UPDATE group_members
             SET user_profile_id = ?
             WHERE telegram_id = ? AND (user_profile_id IS NULL OR user_profile_id != ?)`
          )
          .run(user.id, user.telegramId, user.id);
      }
    } catch (e) {
      console.error('[AuthService] syncMemberLinks error:', e);
    }
  }

  static async upsertUserProfile(userData: any) {
    const existing = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.authUserId, userData.id),
    });

    const now = new Date().toISOString();
    const photoUrl =
      userData.photoUrl ||
      userData.photo_url ||
      userData.avatarUrl ||
      userData.avatar_url ||
      userData.picture ||
      null;
    const telegramId = userData.telegramId
      ? String(userData.telegramId)
      : userData.telegram_id
        ? String(userData.telegram_id)
        : existing?.telegramId || null;
    const googleId = userData.googleId || userData.google_id || existing?.googleId || null;
    const firstName = userData.firstName || userData.first_name || existing?.firstName || null;
    const lastName = userData.lastName || userData.last_name || existing?.lastName || null;
    const username =
      (userData.username ? String(userData.username).replace(/^@/, '') : null) ||
      existing?.username ||
      null;

    let savedUser: typeof userProfiles.$inferSelect;

    if (existing) {
      const [updated] = await db
        .update(userProfiles)
        .set({
          telegramId,
          telegramChatId: existing.telegramChatId || telegramId,
          googleId,
          email: userData.email || existing.email || null,
          firstName,
          lastName,
          username,
          photoUrl: photoUrl || existing.photoUrl,
          updatedAt: now,
        })
        .where(eq(userProfiles.authUserId, userData.id))
        .returning();
      savedUser = updated;
    } else {
      const [inserted] = await db
        .insert(userProfiles)
        .values({
          id: crypto.randomUUID(),
          authUserId: userData.id,
          telegramId,
          telegramChatId: telegramId,
          googleId,
          email: userData.email || null,
          firstName,
          lastName,
          username,
          photoUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      savedUser = inserted;
    }

    await this.syncMemberLinks(savedUser);
    return savedUser;
  }
}
