import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // Only these email addresses may create a sign-in account. Add one with
  // `npx convex run invites:add '{"email":"name@example.com"}'`.
  invitedEmails: defineTable({
    email: v.string(),
    addedAt: v.number(),
  }).index("email", ["email"]),
});
