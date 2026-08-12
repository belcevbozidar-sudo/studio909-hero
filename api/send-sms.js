/* Праща потвърдителен SMS през Twilio. Приема САМО български мобилни номера
   (+359 8x/9x...) — защита срещу SMS pumping измами с чужди премиум номера.
   Rate limit по IP ограничава масови заявки. */

const CONVEX_URL = 'https://academic-dalmatian-762.eu-west-1.convex.cloud';
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
      key: `sms:${ip}`,
      windowMs: 10 * 60 * 1000,
      max: 3,
    });
    return !!result.limited;
  } catch (err) {
    console.error('[send-sms] Rate limit check failed, allowing request:', err.message);
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

/* Нормализира до +3598XXXXXXXX / +3599XXXXXXXX; всичко друго → null. */
function normalizeBgMobile(raw) {
  const phone = String(raw || '').replace(/[\s\-().]/g, '');
  let rest = null;
  if (phone.startsWith('+359')) rest = phone.slice(4);
  else if (phone.startsWith('00359')) rest = phone.slice(5);
  else if (phone.startsWith('359')) rest = phone.slice(3);
  else if (phone.startsWith('0')) rest = phone.slice(1);
  if (!rest || !/^[89]\d{8}$/.test(rest)) return null;
  return '+359' + rest;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (await isRateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const { phone } = req.body || {};
  const to = normalizeBgMobile(phone);
  if (!to) {
    res.status(400).json({ error: 'Invalid phone' });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM || 'STUDIO 9';

  if (!accountSid || !authToken) {
    res.status(500).json({ error: 'SMS service not configured' });
    return;
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: 'Благодарим ти! Екипът ни скоро ще разгледа заявката ти и ще се свърже с теб.',
  });

  try {
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        },
        body,
      }
    );

    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      console.error('Twilio error:', errText);
      res.status(502).json({ error: 'SMS send failed' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Twilio request failed:', err);
    res.status(500).json({ error: 'SMS send failed' });
  }
}
