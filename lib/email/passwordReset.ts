import "server-only";
import { getResendClient } from "./resend";

export async function sendPasswordResetEmail(to: string, memberName: string, resetUrl: string): Promise<void> {
  await getResendClient().emails.send({
    from: "Alliance Stats Tracker <onboarding@resend.dev>", // swap for a verified domain sender later
    to,
    subject: "Reset your password",
    html: `<p>Hi ${memberName},</p><p>Click below to set a new password. This link works once and expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}
