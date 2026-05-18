import type { MiddlewareHandler } from 'hono';
import { verifyAccessToken } from '../lib/jwt.js';
import { fail } from '../lib/response.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    role?: 'merchant' | 'customer';
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return fail(c, 401, 'Missing or invalid Authorization header');
  }
  const token = header.slice(7);
  try {
    const claims = await verifyAccessToken(token);
    c.set('userId', claims.sub);
    if (claims.role) c.set('role', claims.role);
  } catch {
    return fail(c, 401, 'Invalid or expired token');
  }
  await next();
};

export const requireRole =
  (role: 'merchant' | 'customer'): MiddlewareHandler =>
  async (c, next) => {
    if (c.get('role') !== role) {
      return fail(c, 403, `Requires ${role} role`);
    }
    await next();
  };
