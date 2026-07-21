/* Праща известията от формите към Telegram от сървъра.
   Токенът и chat_id живеят само в environment variables (Vercel → Settings →
   Environment Variables: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) и никога не
   стигат до браузъра. */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    res.status(500).json({ error: 'Notifications not configured' });
    return;
  }

  if (isRateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const { text, caption, photoBase64 } = req.body || {};

  try {
    if (photoBase64) {
      if (typeof photoBase64 !== 'string' || photoBase64.length > 5_600_000) {
        res.status(400).json({ error: 'Photo too large' });
        return;
      }
      let photo;
      try {
        photo = Buffer.from(photoBase64, 'base64');
      } catch {
        res.status(400).json({ error: 'Invalid photo' });
        return;
      }
      const fd = new FormData();
      fd.append('chat_id', chatId);
      fd.append('caption', String(caption || '').slice(0, 1024));
      fd.append('photo', new Blob([photo]), 'photo.jpg');
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: fd,
      });
      if (!tgRes.ok) throw new Error(`Telegram ${tgRes.status}`);
    } else {
      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Missing text' });
        return;
      }
      const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
      });
      if (!tgRes.ok) throw new Error(`Telegram ${tgRes.status}`);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Telegram notify failed:', err);
    res.status(502).json({ error: 'Notify failed' });
  }
}
