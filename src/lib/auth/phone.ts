import { normaliseWhatsapp } from "@/lib/intake/answers";

/**
 * Phone numbers for signing in. The same reading as the form's WhatsApp box,
 * so a number typed in either place ends up the same: "0803 123 4567" and
 * "+234 803 123 4567" are both "+2348031234567".
 */
export function normalisePhone(input: string): string | null {
  return normaliseWhatsapp(input);
}

/** What the sign-in service stores and puts in the token: digits only, no plus. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** "+234 803 123 4567" for reading. Only Nigerian numbers are grouped; others show as given. */
export function displayPhone(phone: string): string {
  const d = phoneDigits(phone);
  if (d.startsWith("234") && d.length === 13) return `+234 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return d ? `+${d}` : "";
}

/** "+234 ••• ••• 4567": enough to recognise your own number, not to learn someone else's. */
export function maskPhone(phone: string): string {
  const d = phoneDigits(phone);
  if (d.length < 8) return "";
  if (d.startsWith("234") && d.length === 13) return `+234 ••• ••• ${d.slice(9)}`;
  return `+${d.slice(0, Math.min(3, d.length - 4))} ••• ${d.slice(-4)}`;
}

type AuthLikeError = { code?: string; message?: string; status?: number } | null | undefined;

/** Plain sentences for the WhatsApp steps. The raw message is never shown. */
export function whatsappErrorMessage(error: AuthLikeError): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (code === "captcha_failed" || message.includes("captcha")) {
    return "We couldn't confirm you are a person. Reload the page and try again.";
  }
  if (code === "otp_expired" || message.includes("expired")) {
    return "That code isn't right or has expired. Check it, or send a new code.";
  }
  if (code === "over_sms_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429) {
    return "Too many tries. Wait a minute, then try again.";
  }
  if (code === "phone_exists") {
    return "That number is already used by another account. Use a different number.";
  }
  if (code === "sms_send_failed" || message.includes("sending sms") || message.includes("sending otp")) {
    return "We couldn't send the WhatsApp message. Check the number has WhatsApp, or sign in with email.";
  }
  if (code === "phone_provider_disabled" || code === "provider_disabled" || code === "sms_provider_disabled") {
    return "WhatsApp sign-in isn't turned on yet. Use another option.";
  }
  if (code === "validation_failed" || message.includes("invalid phone") || message.includes("phone")) {
    return "That number doesn't look right. Include your network code, like 0803 123 4567.";
  }
  if (message.includes("token") || message.includes("otp") || message.includes("invalid")) {
    return "That code isn't right. Check the WhatsApp message and try again.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Try again in a moment.";
}

/**
 * The sign-in service says "no sign-ups" when a number has no account. The
 * screen treats that exactly like a sent code, so nobody can use it to find
 * out whose number is on the platform.
 */
export function isUnknownAccount(error: AuthLikeError): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return error?.code === "otp_disabled" || error?.code === "signup_disabled" || message.includes("signups not allowed");
}
