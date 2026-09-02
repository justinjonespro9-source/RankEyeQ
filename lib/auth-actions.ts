"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { logAuthFailure } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";

export async function signInWithEmailAction(formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const callbackUrl = String(formData.get("callbackUrl") || "/rank");
  if (!email) {
    return { ok: false as const, error: "Email is required" };
  }

  const limited = rateLimit({
    key: await rateLimitKey("auth-email", email.slice(0, 3)),
    ...RATE_LIMITS.authEmail,
  });
  if (!limited.ok) {
    logAuthFailure("rate_limited");
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }

  try {
    await signIn("nodemailer", {
      email,
      redirectTo: callbackUrl,
    });
    return { ok: true as const };
  } catch (error) {
    // Successful Auth.js flows throw a redirect; rethrow those.
    if (
      typeof error === "object" &&
      error &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    if (error instanceof AuthError) {
      logAuthFailure("magic_link_failed");
      return { ok: false as const, error: "Unable to send sign-in link" };
    }
    throw error;
  }
}

export async function signInWithGoogleAction(formData: FormData) {
  const callbackUrl = String(formData.get("callbackUrl") || "/rank");
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
