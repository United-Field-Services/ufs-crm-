import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { makeFunctionReference } from "convex/server";

// Password reset by emailed one-time code: 8 digits, valid 20 minutes, usable once.
// The message itself is sent by the SMTP action in mailSmtp.ts.
const sendMail = makeFunctionReference<"action", { to: string; subject: string; text: string; html?: string }, null>("mailSmtp:send");

// The code is shown large on purpose: it is the only thing the person needs from this message. The token is digits only.
const resetEmailHtml = (code: string) => `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#23334d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4eaf2;border-radius:12px">
<tr><td style="background:#163d7b;border-radius:12px 12px 0 0;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:bold">UFS People</td></tr>
<tr><td style="padding:28px 24px 8px;font-size:15px;line-height:1.5">Use this code to reset your password:</td></tr>
<tr><td align="center" style="padding:8px 24px 20px"><div style="display:inline-block;background:#edf3fd;border:1px solid #c6d8f2;border-radius:10px;padding:16px 26px;font-family:'Courier New',monospace;font-size:40px;line-height:1;font-weight:bold;letter-spacing:8px;color:#163d7b">${code}</div></td></tr>
<tr><td style="padding:0 24px 24px;font-size:14px;line-height:1.55;color:#4a5b75">It works once and expires in 20 minutes. Enter it on the reset page, then choose your new password.<br><br>If you did not ask to reset your password, you can ignore this email; your password has not changed.</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e4eaf2;font-size:12px;color:#738198">United Field Services &middot; UFS People</td></tr>
</table></td></tr></table></body></html>`;

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
      html: resetEmailHtml(token),
      text: [
        `Your UFS People password reset code is ${token}.`,
        "",
        "It works once and expires in 20 minutes. Enter it on the reset page, then choose your new password.",
        "If you did not ask to reset your password, you can ignore this email; your password has not changed.",
      ].join("\n"),
    });
  },
});
