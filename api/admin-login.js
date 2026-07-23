/* Проверява паролата за админ страницата с одитите и връща подписан токен -
   пази се в localStorage на браузъра и се праща с всяка следваща заявка към
   api/admin-data.js. Паролата живее само в environment variables
   (ADMIN_PASSWORD, Vercel → Settings → Environment Variables). */

import crypto from 'node:crypto';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
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
  if (isRateLimited(clientIp(req))) {
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
