import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/* Всички функции тук изискват таен подпис (AUDIT_INTERNAL_SECRET), известен
   само на нашите два сървърни файла - api/audit.js (записва) и
   api/admin-data.js (чете, след като вече е проверил паролата на админа).
   Без това всеки, който познава адреса на Convex проекта (виден в кода на
   страницата - това е нормално за Convex), би могъл да пише директно в
   базата или да чете всички минали одити в заобикаляне на паролата. */

function checkSecret(secret: string) {
  if (secret !== process.env.AUDIT_INTERNAL_SECRET) {
    throw new Error("Unauthorized");
  }
}

export const generateUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    return await ctx.storage.generateUploadUrl();
  },
});

const findingValidator = v.object({
  category: v.string(),
  severity: v.string(),
  summary: v.string(),
  recommendation: v.string(),
  screenshotIndex: v.union(v.number(), v.null()),
});

export const save = mutation({
  args: {
    secret: v.string(),
    url: v.string(),
    overallScore: v.number(),
    overallImpression: v.string(),
    topPriority: v.string(),
    findings: v.array(findingValidator),
    screenshotIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    const { secret, ...doc } = args;
    return await ctx.db.insert("audits", doc);
  },
});

export const list = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkSecret(secret);
    const docs = await ctx.db.query("audits").order("desc").take(200);
    return docs.map((d) => ({
      id: d._id,
      createdAt: d._creationTime,
      url: d.url,
      overallScore: d.overallScore,
      findingsCount: d.findings.length,
    }));
  },
});

export const get = query({
  args: { secret: v.string(), id: v.id("audits") },
  handler: async (ctx, { secret, id }) => {
    checkSecret(secret);
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    const screenshotUrls = await Promise.all(
      doc.screenshotIds.map((sid) => ctx.storage.getUrl(sid))
    );
    return {
      id: doc._id,
      createdAt: doc._creationTime,
      url: doc.url,
      overallScore: doc.overallScore,
      overallImpression: doc.overallImpression,
      topPriority: doc.topPriority,
      findings: doc.findings,
      screenshotUrls,
    };
  },
});
