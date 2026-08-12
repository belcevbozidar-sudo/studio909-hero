const CONVEX_URL = 'https://academic-dalmatian-762.eu-west-1.convex.cloud';
const AUDIT_INTERNAL_SECRET = (process.env.AUDIT_INTERNAL_SECRET || '').trim();

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

function trimTo(value, max) {
  return String(value || '').trim().slice(0, max);
}

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
      key: `inquiry:${ip}`,
      windowMs: 10 * 60 * 1000,
      max: 5,
    });
    return !!result.limited;
  } catch (err) {
    console.error('[submit-inquiry] Rate limit check failed, allowing request:', err.message);
    return false;
  }
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) }),
  });
  if (!tgRes.ok) throw new Error(`Telegram ${tgRes.status}`);
}

async function sendSms(phone) {
  const to = normalizeBgMobile(phone);
  if (!to) return;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM || 'STUDIO 9';
  if (!accountSid || !authToken) return;

  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: 'Благодарим ти! Екипът ни скоро ще разгледа заявката ти и ще се свърже с теб.',
  });

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
  if (!twilioRes.ok) throw new Error(`Twilio ${twilioRes.status}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!AUDIT_INTERNAL_SECRET) {
    res.status(500).json({ error: 'Inquiry service not configured' });
    return;
  }
  if (await isRateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const inquiry = {
    industry: trimTo(req.body?.industry, 200),
    problem: trimTo(req.body?.problem, 2000),
    noChange: '',
    email: trimTo(req.body?.email, 320),
    phone: trimTo(req.body?.phone, 40),
  };
  const website = trimTo(req.body?.website, 200);

  if (!inquiry.industry || !inquiry.problem || !inquiry.phone) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await convexMutation('submissions:logInquiry', {
      secret: AUDIT_INTERNAL_SECRET,
      ...inquiry,
    });
  } catch (err) {
    console.error('[submit-inquiry] Convex save failed:', err.message);
    res.status(502).json({ error: 'Inquiry save failed' });
    return;
  }

  const lines = [
    'Ново запитване от Big Offer сайта',
    `Индустрия: ${inquiry.industry}`,
    `Проблем: ${inquiry.problem}`,
    `Имейл: ${inquiry.email}`,
    `Телефон: ${inquiry.phone}`,
    `Сегашен сайт: ${website || 'не е посочен'}`,
  ];

  const results = await Promise.allSettled([
    notifyTelegram(lines.join('\n')),
    sendSms(inquiry.phone),
  ]);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('[submit-inquiry] Follow-up failed:', result.reason?.message || result.reason);
    }
  });

  res.status(200).json({ ok: true });
}
