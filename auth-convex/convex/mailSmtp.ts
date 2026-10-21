"use node";
import { v } from "convex/values";
import nodemailer from "nodemailer";
import { internalAction } from "./_generated/server";

// Sends one email through an SMTP account. Settings are Convex environment variables, never source:
//   SMTP_USER   the mailbox that sends (for Gmail: your address)
//   SMTP_PASS   its password (for Gmail: a 16-character App Password; spaces are ignored)
//   SMTP_HOST   optional, default smtp.gmail.com
//   SMTP_PORT   optional, default 465 (SSL); 587 uses STARTTLS
//   SMTP_FROM   optional sender text, default "UFS People <SMTP_USER>"
// Only the server can call this (internal); it is used for password-reset codes.
export const send = internalAction({
  args: { to: v.string(), subject: v.string(), text: v.string() },
  handler: async (_ctx, { to, subject, text }) => {
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS?.replace(/\s+/g, "");
    if (!user || !pass) throw new Error("SMTP is not configured");
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com", port, secure: port === 465, requireTLS: port !== 465,
      auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || `UFS People <${user}>`, to, subject, text });
    } catch (error) {
      // Log only the error type and SMTP status (visible in your Convex dashboard logs); never the address or the provider's message.
      console.error("Password reset email was not sent", {
        code: (error as { code?: string }).code ?? null,
        smtpStatus: (error as { responseCode?: number }).responseCode ?? null,
      });
      throw new Error("Could not send the reset email");
    }
    return null;
  },
});
