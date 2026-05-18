import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function ok<T>(c: Context, data: T, message?: string) {
  return c.json({ success: true, data, ...(message ? { message } : {}) });
}

export function fail(c: Context, status: ContentfulStatusCode, message: string, data?: unknown) {
  return c.json({ success: false, message, ...(data !== undefined ? { data } : {}) }, status);
}
