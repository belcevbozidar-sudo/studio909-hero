/* Защитен достъп до записаните AI одити - проверява токена, издаден от
   api/admin-login.js, и чак тогава чете от Convex. Convex заявките за списъка
   и пълния одит НЕ се викат директно от браузъра, за да не могат да се
   заобиколят с познаване само на имената на функциите. */

import crypto from 'node:crypto';

const CONVEX_URL = 'https://academic-dalmatian-762.eu-west-1.convex.cloud';

function verifyToken(token) {
  if (!process.env.ADMIN_PASSWORD || typeof token !== 'string') return false;
  const [expiryStr, hmac] = token.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || !hmac || Date.now() > expiry) return false;
  const expected = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD).update(expiryStr).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function convexQuery(path, args) {
  const resp = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data.errorMessage || 'Convex query failed');
  return data.value;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!verifyToken(token)) {
    res.status(401).json({ error: 'Невалидна или изтекла сесия.' });
    return;
  }

  try {
    const { action, id } = req.query || {};
    if (action === 'list') {
      const items = await convexQuery('audits:list', {});
      res.status(200).json({ items });
      return;
    }
    if (action === 'get') {
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Липсва id.' });
        return;
      }
      const item = await convexQuery('audits:get', { id });
      if (!item) {
        res.status(404).json({ error: 'Няма такъв одит.' });
        return;
      }
      res.status(200).json({ item });
      return;
    }
    res.status(400).json({ error: 'Неизвестно действие.' });
  } catch (err) {
    console.error('[admin-data]', err.message);
    res.status(500).json({ error: 'Възникна грешка при зареждане на данните.' });
  }
}
