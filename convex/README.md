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

## Автоматичен деплой

`git push` към `main` вече качва и `convex/`. Build командата в
[`vercel.json`](../vercel.json) вика `npx convex deploy` при production build,
удостоверена с `CONVEX_DEPLOY_KEY` (Vercel → Settings → Environment Variables,
само за Production, deploy key с единствено право `deployment:deploy`, взет от
Convex dashboard на **Production** deployment-а, не Development).

При preview деплойове (PR-и, branch-ове) тази стъпка се прескача — ключът
нарочно не е зададен за Preview, за да не може всеки branch да пише в
production Convex база.

Локална разработка с `npx convex dev` продължава да ползва dev
deployment-а (`academic-dalmatian-762`) от `.env.local` — той не се пипа от
build командата по-горе.
