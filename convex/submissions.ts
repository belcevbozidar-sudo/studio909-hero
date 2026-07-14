import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const logInquiry = mutation({
  args: {
    industry: v.string(),
    problem: v.string(),
    noChange: v.string(),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("inquiries", args);
  },
});

export const logReview = mutation({
  args: {
    business: v.string(),
    stars: v.number(),
    review: v.string(),
    hasPhoto: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reviews", args);
  },
});
