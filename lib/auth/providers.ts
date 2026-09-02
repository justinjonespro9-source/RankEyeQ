import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";

/**
 * Provider-specific Auth.js configuration.
 * Add new sign-in methods here without changing UniversalProfile logic.
 */
export function buildAuthProviders(): Provider[] {
  const providers: Provider[] = [];
  const from = process.env.EMAIL_FROM ?? "RankEyeQ <noreply@rankeyeq.local>";

  if (process.env.AUTH_RESEND_KEY) {
    providers.push(
      Resend({
        apiKey: process.env.AUTH_RESEND_KEY,
        from,
      }),
    );
  } else {
    providers.push(
      Nodemailer({
        server: process.env.EMAIL_SERVER ?? "smtp://127.0.0.1:1025",
        from,
        async sendVerificationRequest({ identifier, url }) {
          if (process.env.EMAIL_SERVER && process.env.NODE_ENV === "production") {
            const nodemailer = await import("nodemailer");
            const transport = nodemailer.createTransport(process.env.EMAIL_SERVER);
            await transport.sendMail({
              to: identifier,
              from,
              subject: "Sign in to RankEyeQ",
              text: `Sign in to RankEyeQ:\n${url}\n\nThis link expires shortly.`,
              html: `<p><a href="${url}">Sign in to RankEyeQ</a></p><p>This link expires shortly.</p>`,
            });
            return;
          }

          console.info(
            `[RankEyeQ Auth] Magic link for ${identifier}:\n${url}\n(Configure AUTH_RESEND_KEY or EMAIL_SERVER to send real email.)`,
          );
        },
      }),
    );
  }

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  return providers;
}
