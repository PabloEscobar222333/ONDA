import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

export async function sendSms(to: string, body: string): Promise<void> {
  if (env.OTP_DEV_LOG_ONLY || env.SMS_PROVIDER === 'none') {
    logger.info({ to, body }, '[SMS dev log]');
    return;
  }
  if (env.SMS_PROVIDER === 'hubtel') {
    await sendHubtel(to, body);
    return;
  }
  if (env.SMS_PROVIDER === 'arkesel') {
    await sendArkesel(to, body);
    return;
  }
}

async function sendHubtel(to: string, body: string): Promise<void> {
  if (!env.HUBTEL_CLIENT_ID || !env.HUBTEL_CLIENT_SECRET) {
    throw new Error('Hubtel credentials missing');
  }
  const url = new URL('https://smsc.hubtel.com/v1/messages/send');
  url.searchParams.set('clientid', env.HUBTEL_CLIENT_ID);
  url.searchParams.set('clientsecret', env.HUBTEL_CLIENT_SECRET);
  url.searchParams.set('from', env.SMS_SENDER_ID);
  url.searchParams.set('to', to);
  url.searchParams.set('content', body);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hubtel SMS failed: ${res.status} ${text}`);
  }
}

async function sendArkesel(to: string, body: string): Promise<void> {
  if (!env.ARKESEL_API_KEY) throw new Error('Arkesel API key missing');
  const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.ARKESEL_API_KEY },
    body: JSON.stringify({ sender: env.SMS_SENDER_ID, message: body, recipients: [to] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Arkesel SMS failed: ${res.status} ${text}`);
  }
}
