import type { MiddlewareHandler } from 'hono';
import type { Env } from './index';
import { verifyJwt } from './lib/crypto';

export type AuthUser = { id: string; roles: string[] };

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const h = c.req.header('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = token ? await verifyJwt(token, c.env.JWT_SECRET) : null;
  if (!payload) return c.json({ success: false, error: 'Unauthorized' }, 401);
  c.set('user', { id: String(payload.sub), roles: (payload.roles as string[]) ?? [] });
  await next();
};

export const requireRole =
  (...allowed: string[]): MiddlewareHandler<Env> =>
  async (c, next) => {
    const u = c.get('user');
    if (!u || !u.roles.some((r) => allowed.includes(r))) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    await next();
  };
