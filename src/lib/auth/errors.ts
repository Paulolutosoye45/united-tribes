/**
 * Turns auth errors into plain sentences that say what to do next.
 * The raw message is never shown: it can leak internals and rarely helps.
 */
export function signInErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (code === "captcha_failed" || message.includes("captcha")) {
    return "We couldn't confirm you are a person. Reload the page and try again.";
  }

  // The auth server answers a wrong code and an expired code the same way,
  // so the message covers both and points to the fix.
  if (code === "otp_expired" || message.includes("expired")) {
    return "That code isn't right or has expired. Check it, or send a new code.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429) {
    return "Too many tries. Wait a minute, then try again.";
  }
  if (code === "validation_failed" || code === "email_address_invalid" || message.includes("invalid email")) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (code === "email_provider_disabled" || code === "provider_disabled") {
    return "This sign-in method isn't turned on yet. Use another option.";
  }
  if (message.includes("token") || message.includes("otp") || message.includes("invalid")) {
    return "That code isn't right. Check the email and try again.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Try again in a moment.";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return EMAIL.test(normaliseEmail(value)) && value.trim().length <= 254;
}
