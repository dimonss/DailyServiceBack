import { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/connection.js';
import { userProfiles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AuthService } from '../modules/auth/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userProfile?: typeof userProfiles.$inferSelect;
  }
}

export const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  const queryToken = (request.query as any)?.token;

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof queryToken === 'string' && queryToken.trim()) {
    token = queryToken.trim();
    request.headers.authorization = `Bearer ${token}`;
  } else {
    return reply.code(401).send({ message: 'Необходима авторизация' });
  }

  try {
    const decoded = await request.jwtVerify<{ sub: string }>();
    if (!decoded || !decoded.sub) {
      throw new Error('Invalid token');
    }

    let user = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.authUserId, decoded.sub),
    });

    // Fallback: fetch from ChalyshAuth if user not found locally
    if (!user) {
      user = await AuthService.fetchAndSaveUserProfile(token);
    } else {
      await AuthService.syncMemberLinks(user);
    }

    if (!user) {
      return reply.code(401).send({ message: 'Пользователь не найден' });
    }

    request.userProfile = user;
  } catch (err) {
    return reply.code(401).send({ message: 'Необходима авторизация' });
  }
};
