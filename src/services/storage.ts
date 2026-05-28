import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'
    );
  }
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // We only use Storage + Postgres here, never Realtime — but supabase-js
    // eagerly constructs a RealtimeClient inside createClient(), which throws
    // on Node < 22 ("Node.js 20 detected without native WebSocket support").
    // Supplying the `ws` transport keeps client creation from blowing up.
    realtime: { transport: WebSocket as unknown as never },
  });
  return _client;
}

/**
 * Uploads an object to a Supabase Storage bucket and returns a short-lived
 * signed URL the client can render. We deliberately do not persist the signed
 * URL — only the object path lives in Postgres, and a fresh URL is minted on
 * read.
 */
export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const { error: uploadErr } = await client()
    .storage.from(bucket)
    .upload(key, body, { contentType, upsert: true });
  if (uploadErr) {
    logger.error({ bucket, key, err: uploadErr }, 'Supabase Storage upload failed');
    throw uploadErr;
  }

  const { data, error: signErr } = await client()
    .storage.from(bucket)
    .createSignedUrl(key, env.SUPABASE_SIGNED_URL_TTL_SECONDS);
  if (signErr || !data?.signedUrl) {
    logger.error({ bucket, key, err: signErr }, 'Supabase Storage sign failed');
    throw signErr ?? new Error('Failed to create signed URL');
  }
  return data.signedUrl;
}

/**
 * Mints a fresh signed URL for an already-uploaded object. Use this on the
 * read path where the DB stores only the bucket key.
 */
export async function getSignedUrl(bucket: string, key: string): Promise<string> {
  const { data, error } = await client()
    .storage.from(bucket)
    .createSignedUrl(key, env.SUPABASE_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw error ?? new Error('Failed to create signed URL');
  }
  return data.signedUrl;
}

export function decodeBase64(data: string): { buffer: Buffer; mime: string } {
  const match = data.match(/^data:(.+);base64,(.+)$/);
  if (match) return { mime: match[1]!, buffer: Buffer.from(match[2]!, 'base64') };
  return { mime: 'application/octet-stream', buffer: Buffer.from(data, 'base64') };
}
