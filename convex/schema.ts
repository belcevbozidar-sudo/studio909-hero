import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inquiries: defineTable({
    industry: v.string(),
    problem: v.string(),
    noChange: v.string(),
    email: v.string(),
    phone: v.string(),
    /* optional, защото редовете отпреди добавянето на полето го нямат */
    website: v.optional(v.string()),
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
  /* AI demos are retained only for seven days. The HTML is kept here so the
     primary site record and its expiry are auditable independently of Blob. */
  generatedDemos: defineTable({
    id: v.string(),
    html: v.string(),
    prompt: v.string(),
    theme: v.string(),
    model: v.string(),
    previewUrl: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    fallbackUsed: v.boolean(),
    textGenerationMs: v.union(v.number(), v.null()),
    imageGenerationMs: v.union(v.number(), v.null()),
    outputTokens: v.union(v.number(), v.null()),
    selectedProvider: v.string(),
    assetCount: v.number(),
  }).index("by_demo_id", ["id"]).index("by_expiry", ["expiresAt"]),
  generatedDemoChunks: defineTable({
    demoId: v.string(),
    position: v.number(),
    html: v.string(),
  }).index("by_demo_id", ["demoId", "position"]),
  /* Споделен лимит на заявките между всички сървърни инстанции (Vercel може
     да пуска няколко копия на функцията едновременно/в различни региони - в
     паметта на всяка копие "3 на 10 минути" щеше да значи 3 на инстанция, не
     общо). Един ред на заявка; старите редове се трият периодично. */
  rateLimitHits: defineTable({
    key: v.string(),
    ts: v.number(),
  }).index("by_key", ["key", "ts"]),
});
