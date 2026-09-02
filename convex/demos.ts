import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function checkSecret(secret: string) {
  if (!secret.trim() || secret.trim() !== (process.env.AUDIT_INTERNAL_SECRET || "").trim()) {
    throw new Error("Unauthorized");
  }
}

function checkLength(name: string, value: string, max: number) {
  if (value.length > max) throw new Error(`${name} exceeds ${max} characters`);
}

const demoArgs = {
  secret: v.string(),
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
};

function validateDemo(args: any) {
  if (!/^demo_\d{13}_[a-z0-9]{6,10}$/.test(String(args.id))) throw new Error("Invalid demo id");
  // Convex documents support substantially more than a typical generated page.
  // Keep a firm upper bound to prevent storage abuse, while allowing legitimate
  // image-heavy legacy pages to be retained during the seven-day window.
  checkLength("html", String(args.html), 800_000);
  checkLength("prompt", String(args.prompt), 1_500);
  checkLength("model", String(args.model), 200);
  checkLength("previewUrl", String(args.previewUrl), 300);
  checkLength("selectedProvider", String(args.selectedProvider), 200);
  if (!Number.isFinite(args.createdAt) || !Number.isFinite(args.expiresAt) || args.expiresAt <= args.createdAt) {
    throw new Error("Invalid demo retention period");
  }
  if (!Number.isInteger(args.assetCount) || args.assetCount < 0 || args.assetCount > 3) throw new Error("Invalid asset count");
}

export const save = mutation({
  args: demoArgs,
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    validateDemo(args);
    const { secret, ...doc } = args;
    const existing = await ctx.db.query("generatedDemos").withIndex("by_demo_id", q => q.eq("id", doc.id)).unique();
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("generatedDemos", doc);
    return { id: doc.id, expiresAt: doc.expiresAt };
  },
});

export const get = query({
  args: { secret: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    const demo = await ctx.db.query("generatedDemos").withIndex("by_demo_id", q => q.eq("id", args.id)).unique();
    if (!demo || demo.expiresAt <= Date.now()) return null;
    return demo;
  },
});

export const saveChunk = mutation({
  args: { secret: v.string(), demoId: v.string(), position: v.number(), html: v.string() },
  handler: async (ctx, args) => {
    checkSecret(args.secret);
    if (!/^demo_\d{13}_[a-z0-9]{6,10}$/.test(args.demoId)) throw new Error("Invalid demo id");
    if (!Number.isInteger(args.position) || args.position < 0 || args.position > 100) throw new Error("Invalid chunk position");
    checkLength("html chunk", args.html, 700_000);
    const existing = await ctx.db.query("generatedDemoChunks").withIndex("by_demo_id", q => q.eq("demoId", args.demoId).eq("position", args.position)).unique();
    if (existing) await ctx.db.patch(existing._id, { html: args.html });
    else await ctx.db.insert("generatedDemoChunks", { demoId: args.demoId, position: args.position, html: args.html });
  },
});

export const deleteExpired = mutation({
  args: { secret: v.string(), now: v.number(), limit: v.number() },
  handler: async (ctx, { secret, now, limit }) => {
    checkSecret(secret);
    const rows = await ctx.db
      .query("generatedDemos")
      .withIndex("by_expiry", q => q.lte("expiresAt", now))
      .take(Math.max(1, Math.min(Math.floor(limit), 1_000)));
    for (const row of rows) {
      const chunks = await ctx.db.query("generatedDemoChunks").withIndex("by_demo_id", q => q.eq("demoId", row.id)).collect();
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      await ctx.db.delete(row._id);
    }
    return { removed: rows.length };
  },
});
