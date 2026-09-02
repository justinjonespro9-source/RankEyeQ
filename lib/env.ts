export type EnvIssue = {
  key: string;
  message: string;
};

export type EnvValidationResult = {
  ok: boolean;
  errors: EnvIssue[];
  warnings: EnvIssue[];
  /** Safe flags only — never include secret values. */
  summary: {
    hasDatabaseUrl: boolean;
    hasAuthSecret: boolean;
    hasAuthUrl: boolean;
    emailProvider: "resend" | "smtp" | "console" | "none";
    googleOAuth: boolean;
    nflProvider: string;
    hasSportsDataKey: boolean;
    strict: boolean;
    nodeEnv: string;
  };
};

const EXAMPLE_AUTH_SECRETS = new Set([
  "replace-with-a-long-random-secret",
  "changeme",
  "secret",
]);

export function isStrictProductionEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.RANKIQ_STRICT_ENV === "1" ||
    env.VERCEL_ENV === "production"
  );
}

export function validateEnv(
  env: Record<string, string | undefined> = process.env,
  options?: { strict?: boolean },
): EnvValidationResult {
  const strict = options?.strict ?? isStrictProductionEnv(env);
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  if (!env.DATABASE_URL?.trim()) {
    errors.push({ key: "DATABASE_URL", message: "DATABASE_URL is required" });
  }

  const authSecret = env.AUTH_SECRET?.trim() ?? "";
  if (!authSecret) {
    (strict ? errors : warnings).push({
      key: "AUTH_SECRET",
      message: "AUTH_SECRET is required in production",
    });
  } else if (authSecret.length < 32 || EXAMPLE_AUTH_SECRETS.has(authSecret)) {
    (strict ? errors : warnings).push({
      key: "AUTH_SECRET",
      message: "AUTH_SECRET must be a unique value at least 32 characters",
    });
  }

  if (!env.AUTH_URL?.trim()) {
    (strict ? errors : warnings).push({
      key: "AUTH_URL",
      message: "AUTH_URL is required in production (public site URL)",
    });
  }

  const hasResend = Boolean(env.AUTH_RESEND_KEY?.trim());
  const hasSmtp = Boolean(env.EMAIL_SERVER?.trim());
  const hasFrom = Boolean(env.EMAIL_FROM?.trim());
  let emailProvider: EnvValidationResult["summary"]["emailProvider"] = "none";
  if (hasResend) emailProvider = "resend";
  else if (hasSmtp) emailProvider = "smtp";
  else emailProvider = env.NODE_ENV === "production" ? "none" : "console";

  if (strict && !hasResend && !hasSmtp) {
    errors.push({
      key: "EMAIL",
      message:
        "Configure AUTH_RESEND_KEY or EMAIL_SERVER for production magic-link email",
    });
  }
  if ((hasResend || hasSmtp) && !hasFrom) {
    (strict ? errors : warnings).push({
      key: "EMAIL_FROM",
      message: "EMAIL_FROM is required when an email provider is configured",
    });
  }

  const googleId = Boolean(env.AUTH_GOOGLE_ID?.trim());
  const googleSecret = Boolean(env.AUTH_GOOGLE_SECRET?.trim());
  if (googleId !== googleSecret) {
    errors.push({
      key: "AUTH_GOOGLE",
      message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must both be set, or both omitted",
    });
  }

  const nflProvider = (env.NFL_DATA_PROVIDER ?? "mock").toLowerCase();
  if (!["manual", "mock", "sportsdataio"].includes(nflProvider)) {
    errors.push({
      key: "NFL_DATA_PROVIDER",
      message: `Unknown NFL_DATA_PROVIDER "${nflProvider}" (use manual, mock, or sportsdataio)`,
    });
  }
  const hasSportsDataKey = Boolean(env.SPORTSDATAIO_API_KEY?.trim());
  if (nflProvider === "sportsdataio" && !hasSportsDataKey) {
    errors.push({
      key: "SPORTSDATAIO_API_KEY",
      message: "SPORTSDATAIO_API_KEY is required when NFL_DATA_PROVIDER=sportsdataio",
    });
  }

  if (env.RANKIQ_DEV_PROFILE_SWITCHER === "1" && env.NODE_ENV === "production") {
    errors.push({
      key: "RANKIQ_DEV_PROFILE_SWITCHER",
      message: "Dev profile switcher must not be enabled in production",
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      hasDatabaseUrl: Boolean(env.DATABASE_URL?.trim()),
      hasAuthSecret: Boolean(authSecret),
      hasAuthUrl: Boolean(env.AUTH_URL?.trim()),
      emailProvider,
      googleOAuth: googleId && googleSecret,
      nflProvider,
      hasSportsDataKey,
      strict,
      nodeEnv: env.NODE_ENV ?? "development",
    },
  };
}

export function assertProductionEnv(
  env: Record<string, string | undefined> = process.env,
) {
  if (!isStrictProductionEnv(env)) return validateEnv(env);
  const result = validateEnv(env, { strict: true });
  if (!result.ok) {
    const detail = result.errors
      .map((issue) => `${issue.key}: ${issue.message}`)
      .join("; ");
    throw new Error(`RankEYEQ production env invalid: ${detail}`);
  }
  return result;
}
