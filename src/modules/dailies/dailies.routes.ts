import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../plugins/auth.middleware.js';
import { DailiesService } from './dailies.service.js';
import { UpsertDailySchema, UpdateDailySchema, SetActiveGroupSchema } from './dailies.schemas.js';
import { db } from '../../db/connection.js';
import { userProfiles } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function dailiesRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/my',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Get current user daily reports across all groups',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const query = request.query as { groupId?: string; period?: string; search?: string };
      const list = await DailiesService.getMyDailies(request.userProfile!, query);
      return reply.send(list);
    }
  );

  fastify.get(
    '/group/:groupId',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Get daily reports for a specific group',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { groupId } = request.params as { groupId: string };
        const query = request.query as {
          period?: string;
          memberId?: string;
          reportDate?: string;
          search?: string;
        };
        const list = await DailiesService.getGroupDailies(groupId, request.userProfile!, query);
        return reply.send(list);
      } catch (e: any) {
        return reply.code(403).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Submit or update today daily standup report for a group',
        security: [{ bearerAuth: [] }],
        body: UpsertDailySchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const saved = await DailiesService.upsertTodayDaily(request.userProfile!, request.body);
        return reply.send(saved);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Edit a daily standup report before cutoff time',
        security: [{ bearerAuth: [] }],
        body: UpdateDailySchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await DailiesService.updateDailyById(id, request.userProfile!, request.body);
        return reply.send(updated);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Delete a daily standup report before cutoff time',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const res = await DailiesService.deleteDailyById(id, request.userProfile!);
        return reply.send(res);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/active-group',
    {
      schema: {
        tags: ['Dailies'],
        summary: 'Set active group for Telegram private chat standup submissions',
        security: [{ bearerAuth: [] }],
        body: SetActiveGroupSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const [updated] = await db
        .update(userProfiles)
        .set({
          activeGroupId: request.body.groupId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userProfiles.id, request.userProfile!.id))
        .returning();
      return reply.send(updated);
    }
  );
}
