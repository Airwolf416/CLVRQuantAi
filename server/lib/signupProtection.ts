// Owner-requested temporary pause. Re-enable in Railway with
// SIGNUP_BOT_PROTECTION_ENABLED=true after configuring both Turnstile keys.
// When enabled, missing keys must still fail closed.
export function signupProtectionRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIGNUP_BOT_PROTECTION_ENABLED?.trim().toLowerCase() === "true";
}
