import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from 'fastify-type-provider-zod';

import jwtPlugin from './plugins/jwt.plugin.js';
import authRoutes from './modules/auth/auth.routes.js';
import groupsRoutes from './modules/groups/groups.routes.js';
import dailiesRoutes from './modules/dailies/dailies.routes.js';
import { startScheduler } from './services/scheduler.js';
import { TelegramBotService } from './services/telegramBot.js';

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

const start = async () => {
  try {
    await app.register(cors, { origin: true });

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'DailyService API',
          description: 'Global Multi-Group Daily Standup Telegram Bot & Web Interface API',
          version: '1.0.0',
        },
        tags: [
          { name: 'Auth', description: 'Authentication & ChalyshAuth SSO integration' },
          { name: 'Telegram', description: 'Telegram account & chat linking' },
          { name: 'Groups', description: 'Group initialization, schedule settings & team members' },
          { name: 'Dailies', description: 'Daily standup reports management' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/api/docs',
    });

    await app.register(jwtPlugin);

    app.get('/api/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }));

    app.register(authRoutes, { prefix: '/api/auth' });
    app.register(groupsRoutes, { prefix: '/api/groups' });
    app.register(dailiesRoutes, { prefix: '/api/dailies' });

    startScheduler();
    TelegramBotService.start().catch((err) => {
      console.error('[Index] Ошибка запуска Telegram бота:', err);
    });

    const PORT = parseInt(process.env.PORT || '3003', 10);
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`DailyService Backend is running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
