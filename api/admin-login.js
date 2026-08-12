/* Проверява паролата за админ страницата с одитите и връща подписан токен -
   пази се в localStorage на браузъра и се праща с всяка следваща заявка към
   api/admin-data.js. Паролата живее само в environment variables
   (ADMIN_PASSWORD, Vercel → Settings → Environment Variables). */

import crypto from 'node:crypto';

const CONVEX_URL = 'https://reliable-lark-350.eu-west-1.convex.cloud';
const AUDIT_INTERNAL_SECRET = (process.env.AUDIT_INTERNAL_SECRET || '').trim();

async function convexMutation(path, args) {
  const resp = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data.errorMessage || 'Convex mutation failed');
  return data.value;
}

async function isRateLimited(ip) {
  if (!AUDIT_INTERNAL_SECRET) return false;
  try {
    const result = await convexMutation('rateLimits:checkAndRecord', {
      secret: AUDIT_INTERNAL_SECRET,
      key: `admin-login:${ip}`,
      windowMs: 10 * 60 * 1000,
      max: 10,
    });
    return !!result.limited;
  } catch (err) {
    console.error('[admin-login] Rate limit check failed, allowing request:', err.message);
    return false;
  }
}

function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) {
    const parts = fwd.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

const SESSION_DAYS = 30;

function signToken(expiry) {
  const secret = process.env.ADMIN_PASSWORD || '';
  const hmac = crypto.createHmac('sha256', secret).update(String(expiry)).digest('hex');
  return `${expiry}.${hmac}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: 'Админ достъпът не е конфигуриран.' });
    return;
  }
  if (await isRateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Твърде много опити - изчакай малко.' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Грешна парола.' });
    return;
  }

  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  res.status(200).json({ token: signToken(expiry), expiry });
}
