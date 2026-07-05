function normalizeBgPhone(raw) {
  const phone = String(raw || '').replace(/[\s\-().]/g, '');
  if (phone.startsWith('+')) return /^\+\d{8,15}$/.test(phone) ? phone : null;
  if (phone.startsWith('00')) return normalizeBgPhone('+' + phone.slice(2));
  if (phone.startsWith('0')) return /^0\d{9}$/.test(phone) ? '+359' + phone.slice(1) : null;
  if (/^359\d{9}$/.test(phone)) return '+' + phone;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { phone } = req.body || {};
  const to = normalizeBgPhone(phone);
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
