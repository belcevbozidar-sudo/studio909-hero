import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inquiries: defineTable({
    industry: v.string(),
    problem: v.string(),
    noChange: v.string(),
    email: v.string(),
    phone: v.string(),
  }),
  reviews: defineTable({
    business: v.string(),
    stars: v.number(),
    review: v.string(),
    hasPhoto: v.boolean(),
  }),
  audits: defineTable({
    url: v.string(),
    overallScore: v.number(),
    overallImpression: v.string(),
    topPriority: v.string(),
    findings: v.array(
      v.object({
        category: v.string(),
        severity: v.string(),
        summary: v.string(),
        recommendation: v.string(),
        screenshotIndex: v.union(v.number(), v.null()),
      })
    ),
    screenshotIds: v.array(v.id("_storage")),
  }),
  /* Споделен лимит на заявките между всички сървърни инстанции (Vercel може
     да пуска няколко копия на функцията едновременно/в различни региони - в
     паметта на всяка копие "3 на 10 минути" щеше да значи 3 на инстанция, не
     общо). Един ред на заявка; старите редове се трият периодично. */
  rateLimitHits: defineTable({
    key: v.string(),
    ts: v.number(),
  }).index("by_key", ["key", "ts"]),
});
