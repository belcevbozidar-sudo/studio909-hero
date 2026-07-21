import { mutation } from "./_generated/server";
import { v } from "convex/values";

/* v.string() не ограничава дължина - мутациите са публични, затова
   пазим базата от спам с огромни стрингове, като отхвърляме над лимита. */
function checkLen(name: string, value: string, max: number) {
  if (value.length > max) {
    throw new Error(`${name} exceeds ${max} characters`);
  }
}

export const logInquiry = mutation({
  args: {
    industry: v.string(),
    problem: v.string(),
    noChange: v.string(),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    checkLen("industry", args.industry, 200);
    checkLen("problem", args.problem, 2000);
    checkLen("noChange", args.noChange, 2000);
    checkLen("email", args.email, 320);
    checkLen("phone", args.phone, 40);
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
    checkLen("business", args.business, 200);
    checkLen("review", args.review, 3000);
    if (!Number.isInteger(args.stars) || args.stars < 1 || args.stars > 5) {
      throw new Error("stars must be an integer between 1 and 5");
    }
    await ctx.db.insert("reviews", args);
  },
});
