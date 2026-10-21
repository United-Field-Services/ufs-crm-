import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { makeFunctionReference } from "convex/server";

// Password reset by emailed one-time code: 8 digits, valid 20 minutes, usable once.
// The message itself is sent by the SMTP action in mailSmtp.ts.
const sendMail = makeFunctionReference<"action", { to: string; subject: string; text: string }, null>("mailSmtp:send");

export const EmailOTPPasswordReset = Email({
  id: "email-otp-password-reset",
  maxAge: 20 * 60,
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };
    return generateRandomString(random, "0123456789", 8);
  },
  async sendVerificationRequest({ identifier: email, token }, ctx) {
    await ctx.runAction(sendMail, {
      to: email,
      subject: "Your UFS People password reset code",
      text: [
        `Your UFS People password reset code is ${token}.`,
        "",
        "It works once and expires in 20 minutes. Enter it on the reset page, then choose your new password.",
        "If you did not ask to reset your password, you can ignore this email; your password has not changed.",
      ].join("\n"),
    });
  },
});
