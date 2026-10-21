import { getAuthSessionId, getAuthUserId, invalidateSessions } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { action } from "./_generated/server";

// Ends every sign-in session of the caller (all devices). The UFS People server calls this with the
// caller's own token, for example right after a password reset, so no old session survives.
export const endAllMine = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not signed in.");
    await invalidateSessions(ctx, { userId });
    return { ok: true };
  },
});

// The session id in the caller's token, so the server can match it to its own session record.
export const whoami = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const sessionId = await getAuthSessionId(ctx);
    if (userId === null || sessionId === null) throw new ConvexError("Not signed in.");
    return { userId, sessionId };
  },
});
