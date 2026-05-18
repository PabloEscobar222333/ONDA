import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { fail } from '../lib/response.js';
import { logger } from '../lib/logger.js';

export const onError: ErrorHandler = (err, c: Context) => {
  if (err instanceof HTTPException) {
    return fail(c, err.status, err.message);
  }
  if (err instanceof ZodError) {
    return fail(c, 422, 'Validation failed', err.flatten().fieldErrors);
  }
  logger.error({ err, path: c.req.path }, 'Unhandled error');
  return fail(c, 500, 'Internal server error');
};

export const onNotFound: NotFoundHandler = (c) => fail(c, 404, 'Not found');
