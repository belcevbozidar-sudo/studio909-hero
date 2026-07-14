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
});
