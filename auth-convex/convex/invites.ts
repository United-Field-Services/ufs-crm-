import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const record = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db.query("invitedEmails").withIndex("email", (q) => q.eq("email", email)).unique();
    if (!existing) await ctx.db.insert("invitedEmails", { email, addedAt: Date.now() });
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("invitedEmails").collect()).map((row) => row.email),
});

// Invite one person and create their account WITHOUT a usable password. They choose their own
// password with "Forgot password": a code is emailed to them and only they can use it.
// Run from your computer (admin only, not callable from a browser):
//   npx convex run invites:add '{"email":"name@example.com"}'
export const add = internalAction({
  args: { email: v.string() },
  handler: async (ctx, { email: raw }) => {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
    await ctx.runMutation(internal.invites.record, { email });
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      await createAccount(ctx, { provider: "password", account: { id: email, secret }, profile: { email } });
      return { invited: email, accountCreated: true };
    } catch {
      // The account already exists: leave its password untouched.
      return { invited: email, accountCreated: false };
    }
  },
});

// FOR TEST ACCOUNTS ONLY: invite an address and set its password directly (no email). Real people choose their own
// password through "Forgot password". Run from your computer; the password is never stored anywhere but Convex.
//   npx convex run invites:addWithPassword '{"email":"test.user@example.test","password":"..."}'
export const addWithPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email: raw, password }) => {
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) throw new ConvexError("Use 12 to 72 characters.");
    await ctx.runMutation(internal.invites.record, { email });
    try {
      await createAccount(ctx, { provider: "password", account: { id: email, secret: password }, profile: { email } });
      return { invited: email, accountCreated: true };
    } catch {
      await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: password } });
      return { invited: email, accountCreated: false, passwordReplaced: true };
    }
  },
});

// The Convex user id of an invited address: this is the "subject" that UFS People binds to an employee.
//   npx convex run invites:whoIs '{"email":"name@example.com"}'
export const whoIs = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email.trim().toLowerCase())).unique();
    return user ? { userId: user._id } : null;
  },
});

// Remove an invite together with the account, sessions and pending codes behind it.
//   npx convex run invites:remove '{"email":"name@example.com"}'
export const remove = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email: raw }) => {
    const email = raw.trim().toLowerCase();
    const invite = await ctx.db.query("invitedEmails").withIndex("email", (q) => q.eq("email", email)).unique();
    if (invite) await ctx.db.delete(invite._id);
    const users = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect();
    for (const user of users) {
      const accounts = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", user._id)).collect();
      for (const account of accounts) {
        const codes = await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", account._id)).collect();
        for (const code of codes) await ctx.db.delete(code._id);
        await ctx.db.delete(account._id);
      }
      const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect();
      for (const session of sessions) {
        const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", session._id)).collect();
        for (const token of tokens) await ctx.db.delete(token._id);
        await ctx.db.delete(session._id);
      }
      await ctx.db.delete(user._id);
    }
    return { removed: email, users: users.length, invite: !!invite };
  },
});
