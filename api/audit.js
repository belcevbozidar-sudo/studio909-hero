/* Безплатен AI одит на сайт - прави screenshot-и на подадения сайт (headless
   Chromium), изпраща ги към Claude заедно с извлечения текст и връща
   структуриран преглед. Ключът ANTHROPIC_API_KEY живее само в environment
   variables (Vercel → Settings → Environment Variables) и никога не стига до
   браузъра. */

import dns from 'node:dns/promises';
import net from 'node:net';
import puppeteer from 'puppeteer-core';
import Anthropic from '@anthropic-ai/sdk';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const config = { maxDuration: 300 };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const NAV_TIMEOUT_MS = 25000;
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MAX_BODY_TEXT_CHARS = 5000;
const JPEG_QUALITY = 55;

/* Нормален браузърски User-Agent (без "HeadlessChrome") + български език -
   иначе някои хостинги/WAF-ове разпознават заявката като бот и блокират. */
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ACCEPT_LANGUAGE = 'bg-BG,bg;q=0.9,en;q=0.8';

/* Маркери, че сме получили блокираща/защитна страница вместо реалния сайт.
   В такъв случай е по-честно да спрем одита, отколкото да дадем подвеждаща
   ниска оценка на сайт, който реално си работи за нормални посетители. */
const BLOCK_MARKERS = [
  'local_rate_limited', 'rate limited', 'too many requests', 'access denied',
  'attention required', 'checking your browser', 'verify you are human',
  'enable javascript and cookies', 'ddos protection', 'captcha',
];

function looksBlocked(bodyText) {
  const text = (bodyText || '').trim().toLowerCase();
  if (text.length < 40) return true;
  if (text.length < 600 && BLOCK_MARKERS.some(m => text.includes(m))) return true;
  return false;
}

/* ---------------- Rate limit (както в notify.js) ---------------- */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;
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

/* ---------------- Защита срещу вътрешни адреси (SSRF) ---------------- */

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return (
      p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    );
  }
  const low = ip.toLowerCase();
  return (
    low === '::' || low === '::1' ||
    low.startsWith('fc') || low.startsWith('fd') ||
    low.startsWith('fe80') || low.startsWith('::ffff:127.') ||
    low.startsWith('::ffff:10.') || low.startsWith('::ffff:192.168.')
  );
}

async function normalizeAndCheckUrl(rawUrl) {
  let input = String(rawUrl || '').trim();
  if (!input) throw new Error('Моля, въведи адрес на сайт.');
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Адресът не изглежда валиден - провери го и опитай пак.');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Поддържат се само http/https адреси.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Този адрес не може да бъде проверен.');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Този адрес не може да бъде проверен.');
  }
  if (!net.isIP(host)) {
    let addresses;
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new Error('Не намерих такъв сайт - провери адреса и опитай пак.');
    }
    if (addresses.some(a => isPrivateIp(a.address))) {
      throw new Error('Този адрес не може да бъде проверен.');
    }
  }
  return url.toString();
}

/* ---------------- Screenshot логика ---------------- */

const COOKIE_BUTTON_TEXTS = [
  'Приемам', 'Съгласен съм', 'Разбрах', 'Приеми всички',
  'Accept', 'Accept all', 'I agree', 'Got it', 'Allow all', 'OK', 'Ок',
];

async function tryDismissCookieBanner(page) {
  try {
    const clicked = await page.evaluate((texts) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
      for (const t of texts) {
        const el = candidates.find(c => {
          const txt = (c.innerText || '').trim().toLowerCase();
          return txt && txt.length < 40 && txt.includes(t.toLowerCase());
        });
        if (el && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    }, COOKIE_BUTTON_TEXTS);
    if (clicked) await sleep(350);
  } catch {
    /* не е фатално */
  }
}

/* Изчаква видимият текст реално да спре да се променя (анимирани броячи,
   lazy-load), вместо да гадаем фиксирано време. */
async function waitForStableContent(page, { maxChecks = 5, intervalMs = 450 } = {}) {
  let previous = null;
  for (let i = 0; i < maxChecks; i++) {
    let current;
    try {
      current = await page.evaluate(() => document.body.innerText);
    } catch {
      return;
    }
    if (previous !== null && current === previous) return;
    previous = current;
    await sleep(intervalMs);
  }
}

async function extractPageInfo(page) {
  return page.evaluate((maxChars) => {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .slice(0, 12)
      .map(el => el.textContent.trim())
      .filter(Boolean);
    const imagesWithoutAlt = Array.from(document.querySelectorAll('img')).filter(
      img => !img.getAttribute('alt')?.trim()
    ).length;
    const totalImages = document.querySelectorAll('img').length;
    const bodyText = (document.body.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, maxChars);
    return {
      title: document.title || '',
      metaDescription: meta('description'),
      headings,
      totalImages,
      imagesWithoutAlt,
      bodyText,
    };
  }, MAX_BODY_TEXT_CHARS);
}

async function launchBrowser() {
  /* На Vercel ползваме лекия linux Chromium на @sparticuz с puppeteer-core -
     това е двойката, за която @sparticuz/chromium е направен и тестван.
     Локално (dev) - системният Chrome. */
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    /* Vercel не изпраща AWS_* променливите, по които @sparticuz/chromium
       разбира, че е в Lambda-подобна среда и че трябва да разархивира и
       системните библиотеки на браузъра (libnss3 и др.) и да настрои
       LD_LIBRARY_PATH. Задаваме променливата ПРЕДИ пакетът да се зареди
       (той чете средата в момента на зареждане), затова import-ът тук е
       динамичен, а не в началото на файла. */
    if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
      process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
    }
    const { default: chromiumPack } = await import('@sparticuz/chromium');
    try {
      /* Шрифт с кирилица, иначе screenshot-ите на български сайтове са с "квадратчета" */
      await chromiumPack.font('https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf');
      await chromiumPack.font('https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf');
    } catch {
      /* не е фатално */
    }
    return puppeteer.launch({
      args: chromiumPack.args,
      defaultViewport: DESKTOP_VIEWPORT,
      executablePath: await chromiumPack.executablePath(),
      headless: chromiumPack.headless,
    });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    defaultViewport: DESKTOP_VIEWPORT,
    headless: true,
  });
}

async function captureSite(url) {
  const browser = await launchBrowser();
  const screenshots = [];
  let pageInfo = {};
  try {
    const page = await browser.newPage();
    await page.setViewport(DESKTOP_VIEWPORT);
    await page.setUserAgent(DESKTOP_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': ACCEPT_LANGUAGE });
    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await sleep(500);
    await waitForStableContent(page);
    await tryDismissCookieBanner(page);

    pageInfo = await extractPageInfo(page);

    if (looksBlocked(pageInfo.bodyText)) {
      throw new Error(
        'Сайтът не се зареди коректно при автоматизираната проверка - вероятно хостингът му блокира заявки от сървъри. Одитът е спрян, за да не получиш подвеждащ резултат.'
      );
    }

    const shoot = async (label) => {
      const buffer = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
      screenshots.push({ label, base64: Buffer.from(buffer).toString('base64') });
    };

    await shoot('Десктоп - горна част (hero)');

    const fullHeight = await page.evaluate(() => document.body.scrollHeight);
    if (fullHeight > DESKTOP_VIEWPORT.height * 1.3) {
      const maxScroll = fullHeight - DESKTOP_VIEWPORT.height;
      await page.evaluate(y => window.scrollTo(0, y), Math.round(maxScroll * 0.45));
      await sleep(350);
      await waitForStableContent(page);
      await shoot('Десктоп - среда на страницата');

      await page.evaluate(y => window.scrollTo(0, y), maxScroll);
      await sleep(350);
      await waitForStableContent(page);
      await shoot('Десктоп - долна част / футър');
    }
    await page.close();

    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ ...MOBILE_VIEWPORT, isMobile: true, hasTouch: true });
    await mobilePage.setUserAgent(MOBILE_UA);
    await mobilePage.setExtraHTTPHeaders({ 'Accept-Language': ACCEPT_LANGUAGE });
    await mobilePage.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await sleep(500);
    await waitForStableContent(mobilePage);
    await tryDismissCookieBanner(mobilePage);
    const mobileBuffer = await mobilePage.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
    screenshots.push({ label: 'Мобилен изглед', base64: Buffer.from(mobileBuffer).toString('base64') });
    await mobilePage.close();
  } finally {
    await browser.close();
  }
  return { screenshots, pageInfo };
}

/* ---------------- AI преглед ---------------- */

const SYSTEM_PROMPT = `# Роля

Ти си старши консултант по уеб дизайн, UX и дигитален маркетинг с над 15 години опит. Този одит се предоставя безплатно от Studio 9 (studio9.site) на собственици на бизнес, които са въвели адреса на собствения си сайт. Говори директно на собственика ("ти"), конструктивно и честно - все едно той е потенциален клиент, който преценява дали да се довери. Получаваш номерирани screenshot-и от сайта плюс точен текст, извлечен от кода на страницата.

Отговаряй винаги на български език.

Форматиране: никога не използвай дългото тире "—" (em dash). Използвай обикновено късо тире "-".

# Точност - най-важното правило

- За твърдения за title таг / мета описание използвай САМО извлечения текст от кода, не четенето от снимка.
- Текст, който виждаш само на screenshot, докладвай само ако е ясно и недвусмислено четим. Не гадай.
- Разграничавай "грешка" от "нарочен избор" - слоган, име на бранд или игра на думи може да са съзнателни. Ако не си сигурен, формулирай предпазливо ("провери дали ... е нарочно").
- За визуални бъгове докладвай само това, което наистина се вижда на конкретния screenshot, и посочи кой номер е той.
- Никога не твърди какво се случва след клик, изпращане на форма или друго действие, което не е показано на screenshot. Формулирай такива неща като въпрос/липсваща информация, не като факт.
- Броенето на повтарящи се икони (звезди, точки) е ненадеждно и от снимка, и от извлечен текст (CSS може да крие част от тях). Ако има текстов етикет с число - приеми него за верен и не докладвай "несъответствие" от собственото си броене.
- Sticky хедър, който временно застъпва съдържание при скрол, е нормално поведение - докладвай само ако закрива нещо важно за взаимодействие, и то с severity low/medium.
- Официалната валута в България вече е еврото (левът е заменен от еврото). Ако видиш цени в евро (€, EUR) на сайт - това е напълно нормално и очаквано, НЕ го коментирай по никакъв начин (нито като грешка, нито като "странно", нито като препоръка да се смени с лева). Изобщо не отделяй находка само на темата коя валута се използва.
- Не измисляй факти за бизнеса.

# Какво да прегледаш

Първо впечатление (hero, ясно ли е за 3 секунди какво предлага сайтът, има ли ясен CTA), навигация, визуален дизайн и консистентност, текстове и послания (говорят ли на ползата за клиента), конверсия (CTA, форми, триене), доверие (отзиви, контакти, социално доказателство), мобилен изглед, достъпност (alt текстове, контраст), SEO сигнали (title, мета описание, заглавия).

# Формат

- overall_score: цяло число 1-10 (реалистично, не любезно).
- overall_impression: 2-3 изречения общо впечатление, честно, с признание за силните страни.
- top_priority: единственото нещо, което би имало най-голям ефект, ако се оправи първо.
- findings: между 4 и 8 находки, подредени по важност. Всяка с category, severity (low/medium/high), summary (какво виждаш и защо е проблем), recommendation (какво конкретно да се направи), screenshot_index (номер на снимката, за която се отнася, или null). Включи поне една положителна находка (какво е направено добре), ако има такава.

Дай толкова находки, колкото реално са оправдани - не се стреми към точно число. Ако сайтът е добре направен, кажи го честно.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overall_impression: { type: 'string' },
    overall_score: { type: 'integer' },
    top_priority: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          summary: { type: 'string' },
          recommendation: { type: 'string' },
          screenshot_index: { type: ['integer', 'null'] },
        },
        required: ['category', 'severity', 'summary', 'recommendation', 'screenshot_index'],
        additionalProperties: false,
      },
    },
  },
  required: ['overall_impression', 'overall_score', 'top_priority', 'findings'],
  additionalProperties: false,
};

function buildPageInfoSummary(pageInfo) {
  return [
    'Точен текст, извлечен от кода на страницата (използвай това за твърдения за title/мета описание, не четенето от снимка):',
    `- Заглавие на страницата (title таг): "${pageInfo.title || '(няма)'}"`,
    `- Мета описание: "${pageInfo.metaDescription || '(липсва)'}"`,
    `- Заглавия (H1/H2): ${pageInfo.headings?.join(' | ') || '(няма)'}`,
    `- Общо изображения: ${pageInfo.totalImages ?? '?'}, без alt текст: ${pageInfo.imagesWithoutAlt ?? '?'}`,
    '',
    'Пълен видим текст на страницата:',
    pageInfo.bodyText || '(няма извлечен текст)',
  ].join('\n');
}

async function reviewSite({ url, screenshots, pageInfo }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const content = [
    {
      type: 'text',
      text: `Прегледай сайта на адрес: ${url}\n\nПо-долу ще видиш ${screenshots.length} screenshot-а. Всеки е предшестван от номера си (screenshot_index) - използвай точно този номер в полето "screenshot_index" на всяка находка.`,
    },
  ];
  screenshots.forEach((s, i) => {
    content.push({ type: 'text', text: `--- Screenshot ${i}: ${s.label} ---` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: s.base64 },
    });
  });
  content.push({ type: 'text', text: buildPageInfoSummary(pageInfo) });

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 9000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
  });
  const response = await stream.finalMessage();

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('AI прегледът не върна отговор - опитай отново.');
  return JSON.parse(textBlock.text);
}

/* ---------------- Telegram известие (същия бот като формите) ---------------- */

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4096) }),
    });
  } catch {
    /* известието никога не трябва да проваля самия одит */
  }
}

/* ---------------- HTTP handler ---------------- */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Одитът временно не е наличен.' });
    return;
  }
  if (isRateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Твърде много заявки от този адрес - опитай отново след 10 минути.' });
    return;
  }

  const { url } = req.body || {};
  const startedAt = Date.now();
  try {
    const safeUrl = await normalizeAndCheckUrl(url);
    const { screenshots, pageInfo } = await captureSite(safeUrl);
    const result = await reviewSite({ url: safeUrl, screenshots, pageInfo });
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    await notifyTelegram(
      `🤖 Нов AI одит на сайт\n\n` +
      `Сайт: ${safeUrl}\n` +
      `Оценка: ${result.overall_score}/10\n` +
      `Находки: ${result.findings?.length ?? '?'}\n` +
      `Време: ${elapsed} сек`
    );
    res.status(200).json({ url: safeUrl, result, screenshots });
  } catch (err) {
    const msg = err?.message || '';
    const friendly =
      /Моля|адрес|сайт|проверен|валиден|http|зареди|блокира/i.test(msg)
        ? msg
        : /Timeout|timeout|net::|NS_ERROR/.test(msg)
          ? 'Не успях да отворя сайта - провери дали адресът е верен и дали сайтът работи.'
          : 'Възникна неочаквана грешка при одита - опитай отново след малко.';
    console.error('[audit]', msg);
    if (url && String(url).trim()) {
      await notifyTelegram(
        `⚠️ Неуспешен опит за AI одит\n\n` +
        `Въведен адрес: ${String(url).trim().slice(0, 200)}\n` +
        `Причина: ${friendly}`
      );
    }
    res.status(400).json({ error: friendly });
  }
}
