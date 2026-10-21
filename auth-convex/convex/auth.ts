import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { EmailOTPPasswordReset } from "./EmailOTPPasswordReset";

// Same limits as the UFS People app: 12 to 72 characters (72 bytes is the most the
// password hash looks at), 15-minute access tokens, 12-hour sessions, 30-minute idle limit.
const MIN_PASSWORD = 12;
const MAX_PASSWORD_BYTES = 72;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      reset: EmailOTPPasswordReset,
      validatePasswordRequirements(password: string) {
        if (typeof password !== "string" || password.length < MIN_PASSWORD) {
          throw new ConvexError(`Use at least ${MIN_PASSWORD} characters.`);
        }
        if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
          throw new ConvexError(`Use at most ${MAX_PASSWORD_BYTES} characters.`);
        }
      },
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Invalid email.");
        return { email };
      },
    }),
  ],
  session: { totalDurationMs: 12 * 60 * 60 * 1000, inactiveDurationMs: 30 * 60 * 1000 },
  jwt: { durationMs: 15 * 60 * 1000 },
  signIn: { maxFailedAttempsPerHour: 10 },
  callbacks: {
    // Invite-only: an account can only be created for an address on the invite list.
    // Everything else (including a direct call to the public sign-up flow) is refused.
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;
      const email = String(args.profile.email ?? "").toLowerCase();
      const invited = email
        ? await ctx.db.query("invitedEmails").withIndex("email", (q) => q.eq("email", email)).unique()
        : null;
      if (!invited) throw new ConvexError("Sign-up is not available.");
      return await ctx.db.insert("users", { email });
    },
  },
});
