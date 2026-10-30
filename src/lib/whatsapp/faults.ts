/**
 * What a rejection from Meta says about the church's own WhatsApp account, in plain words (WhatsApp that cannot fail quietly).
 *
 * These are the codes the database counts as a fault with the ACCOUNT, not with one member (public.whatsapp_fault_code in
 * supabase/migrations/20270103000100_whatsapp_safety.sql, kept in step with this list by a test). A code about one member (the number is not on
 * WhatsApp, too many messages to one person) is never in this list.
 */
export const ACCOUNT_FAULT_CODES = [10, 190, 200, 368, 401, 403, 131030, 131031, 131037, 131042, 131045] as const;

const WORDS: Record<number, { cause: string; fix: string }> = {
  190: {
    cause: "the access token has expired or is wrong",
    fix: "Make a token that never expires (a system-user token), put it in WHATSAPP_ACCESS_TOKEN and redeploy.",
  },
  10: { cause: "the access token is missing a permission", fix: "Make a new system-user token with the three WhatsApp permissions, and redeploy." },
  200: { cause: "the access token is missing a permission", fix: "Make a new system-user token with the three WhatsApp permissions, and redeploy." },
  401: { cause: "Meta refused our access", fix: "Check WHATSAPP_ACCESS_TOKEN: it is probably expired or from a different app." },
  403: { cause: "Meta refused our access", fix: "Check WHATSAPP_ACCESS_TOKEN: it is probably expired or from a different app." },
  131030: {
    cause: "the sender is a test number, which can reach only five hand-verified phones",
    fix: "Register the church's own number in WhatsApp Manager, and use its Phone number ID in WHATSAPP_PHONE_NUMBER_ID.",
  },
  131031: { cause: "the WhatsApp account is locked", fix: "Open WhatsApp Manager and follow what it says; it usually asks for business verification or an appeal." },
  131037: { cause: "the sender's display name needs approval", fix: "Open WhatsApp Manager → Phone numbers and finish the display-name review." },
  131042: { cause: "there is a payment problem on the WhatsApp account", fix: "Open WhatsApp Manager → Payment settings and add or fix the card." },
  131045: { cause: "the sending number is not registered", fix: "Open the app's API Setup page and finish registering the number." },
  368: { cause: "Meta has temporarily blocked the account for a policy reason", fix: "Open WhatsApp Manager → Account quality and read the notice; sending resumes when the block ends." },
};

/** "the access token has expired or is wrong" for 190, and a safe general line for any other. */
export function faultCause(code: number): string {
  return WORDS[code]?.cause ?? "WhatsApp refused the account";
}

/** What to do about it, in one sentence. */
export function faultFix(code: number): string {
  return WORDS[code]?.fix ?? "Open WhatsApp Manager and read what Meta says about the account.";
}
