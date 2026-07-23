import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/* Извикват се от сървъра (api/audit.js и api/admin-data.js), не директно от
   браузъра на посетителя - там няма нужда от паролна защита на ниво Convex,
   защото истинската защита е в api/admin-data.js (проверява админ токена),
   преди изобщо да достигне дотук. */

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
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
    url: v.string(),
    overallScore: v.number(),
    overallImpression: v.string(),
    topPriority: v.string(),
    findings: v.array(findingValidator),
    screenshotIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("audits", args);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
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
  args: { id: v.id("audits") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;
    const screenshotUrls = await Promise.all(
      doc.screenshotIds.map((id) => ctx.storage.getUrl(id))
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
