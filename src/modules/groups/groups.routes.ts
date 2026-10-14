import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate } from '../../plugins/auth.middleware.js';
import { GroupsService } from './groups.service.js';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddGroupMemberSchema,
  BulkImportMembersSchema,
  UpdateGroupMemberSchema,
} from './groups.schemas.js';
import { TelegramBotService } from '../../services/telegramBot.js';
import { generateGroupXlsxBuffer, type ExportPeriod } from '../../utils/xlsxExport.js';

export default async function groupsRoutes(app: FastifyInstance) {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.get(
    '/',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get current user admin group (max 1) and all member groups',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const overview = await GroupsService.getUserGroupsOverview(request.userProfile!);
      return reply.send(overview);
    }
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Initialize / create a new group as Admin (limited to 1 per user)',
        security: [{ bearerAuth: [] }],
        body: CreateGroupSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const created = await GroupsService.createAdminGroup(request.userProfile!, request.body);
        return reply.code(201).send(created);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message || 'Ошибка создания группы' });
      }
    }
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get group details with members and today standup statuses',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { group, isAdmin, member } = await GroupsService.verifyGroupAccess(id, request.userProfile!);
        const enriched = await GroupsService.enrichGroupWithTodayStats(group);
        return reply.send({ ...enriched, isAdmin, myMembership: member });
      } catch (e: any) {
        return reply.code(403).send({ message: e.message });
      }
    }
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Update group configuration and schedule (Admin only)',
        security: [{ bearerAuth: [] }],
        body: UpdateGroupSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const updated = await GroupsService.updateGroup(id, request.userProfile!.id, request.body);
        return reply.send(updated);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/:id/regenerate-init-code',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Regenerate 6-digit /init code for binding Telegram group chat',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const res = await GroupsService.regenerateInitCode(id, request.userProfile!.id);
        return reply.send(res);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Delete administered group (Admin only)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const res = await GroupsService.deleteGroup(id, request.userProfile!.id);
        return reply.send(res);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  // ==================== MEMBERS MANAGEMENT ====================

  fastify.post(
    '/:id/members',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Add a member to the group (Admin only)',
        security: [{ bearerAuth: [] }],
        body: AddGroupMemberSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const member = await GroupsService.addMember(id, request.userProfile!.id, request.body);
        return reply.code(201).send(member);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/:id/members/bulk',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Bulk import members in teamReminderBot pipe-separated format (Admin only)',
        security: [{ bearerAuth: [] }],
        body: BulkImportMembersSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const added = await GroupsService.bulkImportMembers(id, request.userProfile!.id, request.body);
        return reply.send({ addedCount: added.length, added });
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.patch(
    '/:id/members/:memberId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Update group member settings (Admin only)',
        security: [{ bearerAuth: [] }],
        body: UpdateGroupMemberSchema,
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id, memberId } = request.params as { id: string; memberId: string };
        const updated = await GroupsService.updateMember(id, memberId, request.userProfile!.id, request.body);
        return reply.send(updated);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.delete(
    '/:id/members/:memberId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Remove a member from the group (Admin only)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id, memberId } = request.params as { id: string; memberId: string };
        const res = await GroupsService.removeMember(id, memberId, request.userProfile!.id);
        return reply.send(res);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  // ==================== MANUAL BOT ACTIONS & XLSX EXPORT ====================

  fastify.post(
    '/:id/trigger-report',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Send daily summary report to Telegram group right now (Admin only)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        await GroupsService.verifyGroupAdmin(id, request.userProfile!.id);
        const result = await TelegramBotService.runDailyGroupReport(id);
        if (!result.sent) {
          return reply.code(400).send({ message: result.message });
        }
        return reply.send(result);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/:id/trigger-public-remind',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Send public reminder tagging missing members in Telegram group (Admin only)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        await GroupsService.verifyGroupAdmin(id, request.userProfile!.id);
        const result = await TelegramBotService.runDailyPublicRemind(id);
        if (!result.sent) {
          return reply.code(400).send({ message: 'Группа не привязана к Telegram чату' });
        }
        return reply.send(result);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.post(
    '/:id/trigger-private-remind',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Send private DM reminders to missing members (Admin only)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        await GroupsService.verifyGroupAdmin(id, request.userProfile!.id);
        const result = await TelegramBotService.runDailyPrivateRemind(id);
        return reply.send(result);
      } catch (e: any) {
        return reply.code(400).send({ message: e.message });
      }
    }
  );

  fastify.get(
    '/:id/export-xlsx',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Download Excel (.xlsx) report of group daily tasks (all, month, week)',
        security: [{ bearerAuth: [] }],
      },
      preHandler: [authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const query = request.query as { period?: string };
        await GroupsService.verifyGroupAccess(id, request.userProfile!);

        const period: ExportPeriod =
          query.period === 'week' ? 'week' : query.period === 'month' ? 'month' : 'all';

        const { buffer, filename } = await generateGroupXlsxBuffer(id, period);

        reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
          .send(buffer);
      } catch (e: any) {
        return reply.code(403).send({ message: e.message });
      }
    }
  );
}
