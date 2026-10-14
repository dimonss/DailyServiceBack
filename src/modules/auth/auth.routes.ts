import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuthService } from './auth.service.js';
import { GoogleAuthSchema, RefreshTokenSchema, TelegramAuthSchema } from './auth.schemas.js';
import { authenticate } from '../../plugins/auth.middleware.js';
import { db } from '../../db/connection.js';
import { userProfiles, telegramChats } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function authRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/telegram',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Authenticate via Telegram Widget',
        body: TelegramAuthSchema,
      },
    },
    async (request, reply) => {
      try {
        const result = await AuthService.loginTelegram(request.body);
        return reply.send(result);
      } catch (e: any) {
        request.log.error(e);
        return reply.code(400).send({ message: 'Ошибка авторизации', error: e.message });
      }
    }
  );

  fastify.post(
    '/google',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Authenticate via Google OAuth',
        body: GoogleAuthSchema,
      },
    },
    async (request, reply) => {
      try {
        const result = await AuthService.loginGoogle(request.body as any);
        return reply.send(result);
      } catch (e: any) {
        request.log.error(e);
        return reply.code(400).send({ message: 'Ошибка авторизации', error: e.message });
      }
    }
  );

  fastify.post(
    '/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        body: RefreshTokenSchema,
      },
    },
    async (request, reply) => {
      try {
        const result = await AuthService.refreshTokens(request.body.refreshToken);
        return reply.send(result);
      } catch (e: any) {
        return reply.code(401).send({ message: 'Ошибка обновления токена', error: e.message });
      }
    }
  );

  fastify.post(
    '/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log out user (revoke refresh token)',
        body: RefreshTokenSchema,
      },
    },
    async (request, reply) => {
      try {
        await AuthService.logout(request.body.refreshToken);
        return reply.send({ message: 'Вышли из системы' });
      } catch (e: any) {
        return reply.code(400).send({ message: 'Ошибка выхода', error: e.message });
      }
    }
  );

  fastify.get(
    '/me',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { TelegramBotService } = await import('../../services/telegramBot.js');
      return reply.send({
        ...request.userProfile,
        botUsername: TelegramBotService.getBotUsername(),
      });
    }
  );

  fastify.post(
    '/telegram-link-code',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Generate Telegram account linking code',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { TelegramBotService } = await import('../../services/telegramBot.js');
      const userProf = request.userProfile;
      if (!userProf) return reply.code(401).send({ message: 'Не авторизован' });
      const result = TelegramBotService.generateLinkCode(userProf.id);
      return reply.send(result);
    }
  );

  fastify.post(
    '/telegram-unlink',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Unlink Telegram account from user',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const userProf = request.userProfile;
      if (!userProf) return reply.code(401).send({ message: 'Не авторизован' });

      const [updated] = await db
        .update(userProfiles)
        .set({ telegramId: null, telegramChatId: null, updatedAt: new Date().toISOString() })
        .where(eq(userProfiles.id, userProf.id))
        .returning();

      return reply.send({ message: 'Telegram отвязан', userProfile: updated });
    }
  );

  fastify.get(
    '/telegram-chats',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Get list of available Telegram chats where bot is present',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { TelegramBotService } = await import('../../services/telegramBot.js');
      const userProf = request.userProfile;
      if (!userProf) return reply.send([]);

      const allChats = await db.query.telegramChats.findMany();
      const userChats = [];

      for (const chat of allChats) {
        const isRegisteredByMe =
          (userProf.telegramId && chat.registeredByTelegramId === userProf.telegramId) ||
          (userProf.username &&
            chat.registeredByUsername?.toLowerCase() === userProf.username.toLowerCase());

        const isPrivateMe = userProf.telegramId && chat.chatId === userProf.telegramId;

        const isInGroup =
          userProf.telegramId &&
          chat.type !== 'private' &&
          (await TelegramBotService.isUserInChat(chat.chatId, userProf.telegramId));

        if (isRegisteredByMe || isPrivateMe || isInGroup) {
          userChats.push(chat);
        }
      }

      return reply.send(userChats);
    }
  );

  fastify.patch(
    '/telegram-chats/:chatId',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Toggle notifications for a Telegram chat',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { TelegramBotService } = await import('../../services/telegramBot.js');
      const { chatId } = request.params as { chatId: string };
      const { isActive } = request.body as { isActive: boolean };

      await TelegramBotService.toggleChatActive(chatId, isActive);
      return reply.send({ message: 'Статус чата обновлен' });
    }
  );

  fastify.delete(
    '/telegram-chats/:chatId',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Unregister/remove a Telegram chat',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { TelegramBotService } = await import('../../services/telegramBot.js');
      const { chatId } = request.params as { chatId: string };

      await TelegramBotService.unregisterChat(chatId);
      return reply.send({ message: 'Чат отключен' });
    }
  );
}
