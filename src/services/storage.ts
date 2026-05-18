import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  if (!env.R2_ACCESS_KEY_ID) {
    logger.warn({ bucket, key }, '[Storage stub] R2 not configured, skipping upload');
    return `stub://r2/${bucket}/${key}`;
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  if (env.R2_PUBLIC_BASE_URL) return `${env.R2_PUBLIC_BASE_URL}/${key}`;
  return await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 3600,
  });
}

export function decodeBase64(data: string): { buffer: Buffer; mime: string } {
  const match = data.match(/^data:(.+);base64,(.+)$/);
  if (match) return { mime: match[1]!, buffer: Buffer.from(match[2]!, 'base64') };
  return { mime: 'application/octet-stream', buffer: Buffer.from(data, 'base64') };
}
