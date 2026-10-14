/**
 * Every sentence the sign-in code feature says that is not in a screen's own markup. One place, so the words that
 * go to a phone, the words on the screen, and the tests all agree.
 */

/** The only message the sign-in number ever sends with a code: who it is from, the code, and how to stop it. No link. */
export function codeMessage(code: string): string {
  return `United Tribes sign-in code: ${code}\n\nIgnore this if you did not ask. Reply STOP to stop these.`;
}

/** What the number says back when someone replies STOP or "not me". */
export const STOP_REPLY = "Okay. We will not send sign-in codes to this number for 30 days. You can still sign in with Google or email.";

/** What a person types or taps to ask for their code (reply-first). Any message other than STOP works; this is the suggestion. */
export const ASK_TEXT = "Send my code";

export const PAUSED_LINE = "WhatsApp codes are paused today. Use email.";
export const NOT_ADDED_LINE =
  "WhatsApp sign-in works once your number is added to your account. Add it in Privacy and my data after signing in with Google or email.";
export const CODE_LIFETIME_LINE = "The code works for 10 minutes.";
export const NETWORK_LINE = "Too many codes have been asked for from this connection. Wait a little while, or use email.";
export const BAD_NUMBER_LINE = "That number doesn't look right. Include your network code, like 0803 123 4567.";
export const UNAVAILABLE_LINE = "We couldn't send a code right now. Use email instead.";
export const OFF_LINE = "WhatsApp sign-in isn't turned on yet. Use email.";

/** A link that opens WhatsApp with a message ready to send to the sign-in number. `digits` is the number without a plus. */
export function openWhatsAppLink(digits: string, text = ASK_TEXT): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
