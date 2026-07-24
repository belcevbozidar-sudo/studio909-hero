import { mutation } from "./_generated/server";
import { v } from "convex/values";

function checkSecret(secret: string) {
  if (secret !== process.env.AUDIT_INTERNAL_SECRET) {
    throw new Error("Unauthorized");
  }
}

/* Атомарна проверка "не е ли надвишен лимитът" + запис на нова заявка -
   споделена между всички сървърни инстанции (за разлика от лимит в паметта
   на отделна функция, който не важи общо). Трие и старите редове за същия
   ключ, за да не расте таблицата неограничено. */
export const checkAndRecord = mutation({
  args: { secret: v.string(), key: v.string(), windowMs: v.number(), max: v.number() },
  handler: async (ctx, { secret, key, windowMs, max }) => {
    checkSecret(secret);
    const now = Date.now();
    const windowStart = now - windowMs;

    const stale = await ctx.db
      .query("rateLimitHits")
      .withIndex("by_key", (q) => q.eq("key", key).lt("ts", windowStart))
      .collect();
    for (const row of stale) await ctx.db.delete(row._id);

    const recent = await ctx.db
      .query("rateLimitHits")
      .withIndex("by_key", (q) => q.eq("key", key).gte("ts", windowStart))
      .collect();

    if (recent.length >= max) {
      return { limited: true };
    }
    await ctx.db.insert("rateLimitHits", { key, ts: now });
    return { limited: false };
  },
});
