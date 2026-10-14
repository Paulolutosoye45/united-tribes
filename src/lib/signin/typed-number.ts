import { normalisePhone } from "@/lib/auth/phone";

/**
 * Reads a number typed into the WhatsApp box on the sign-in screen. The box shows "+234" in front of what is typed, so
 * people naturally leave off the first zero ("803 123 4567"). That, and the ways a number is normally written
 * ("0803 123 4567", "+234 803 123 4567"), all read as the same number. Anything else stays unread (null), and the
 * screen says what to do.
 *
 * When the typed text begins with a plus or 00 the person is giving a full international number, so the "+234" in
 * front of the box is hidden (see showsNigerianPrefix) and nothing is added.
 */
export function readTypedNumber(raw: string): string | null {
  const direct = normalisePhone(raw);
  if (direct) return direct;
  const digits = raw.replace(/[\s\-().]/g, "");
  // A Nigerian mobile number without its leading zero: ten digits starting 7, 8 or 9.
  if (/^[789]\d{9}$/.test(digits)) return normalisePhone(`0${digits}`);
  return null;
}

/** Whether to draw "+234" in front of the box: not once the person has begun a full international number. */
export function showsNigerianPrefix(raw: string): boolean {
  return !/^\s*(\+|00)/.test(raw);
}
