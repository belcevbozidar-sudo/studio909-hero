# Convex — как се деплойва

Сайтът в production чете и пише в **production** deployment-а:

```
reliable-lark-350.eu-west-1.convex.cloud
```

Този адрес е записан като `CONVEX_URL` в `api/submit-inquiry.js`, `api/audit.js`,
`api/admin-data.js` и `api/admin-login.js`. Ако някога се смени, трябва да се
смени и на четирите места.

`.env.local` сочи към **dev** deployment-а (`academic-dalmatian-762`) — той се
ползва само от `npx convex dev` при локална работа и вече не обслужва сайта.

## Важно: `git push` НЕ качва промените по тази папка

Vercel деплойва само статичния сайт и `api/`. Функциите и схемата в `convex/`
живеят в Convex и се качват отделно. След всяка промяна тук:

```bash
npm run convex:deploy
```

Пропуснатият деплой не дава грешка при билда — сайтът просто продължава да вика
старата версия на функцията и запитванията от формата се губят.

## Автоматичен деплой (по избор)

За да пада тази стъпка, в Convex dashboard → Settings → Deploy Keys се генерира
production deploy key, добавя се във Vercel като `CONVEX_DEPLOY_KEY`, и build
командата на проекта става `npx convex deploy`. Докато ключът не е зададен,
build командата трябва да остане празна — иначе деплоят на сайта ще фейлва.
