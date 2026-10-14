import { z } from "zod";

/**
 * What Supabase sends to the "Send SMS" hook: the person and the code.
 * Only the fields used here are read; anything else is ignored.
 */
const hookSchema = z.object({
  user: z.object({
    id: z.string().min(1).max(64),
    phone: z.string().max(32).nullish(),
    new_phone: z.string().max(32).nullish(),
  }),
  sms: z.object({ otp: z.string().regex(/^\d{4,8}$/) }),
});

/** sign_in: a code for someone signing in. add_number: a code that proves a new number is theirs (they are already signed in). */
export type HookRequest = { userId: string; to: string; code: string; flow: "sign_in" | "add_number" };

/**
 * Reads the request and works out which number the code is for.
 *
 * When someone adds or changes a number, the code must go to the NEW number
 * (the old one may be lost), which Supabase gives as `new_phone`. Otherwise
 * it is the number on the account. Returns null for anything unreadable, or
 * with no number to send to.
 */
export function readHookRequest(raw: unknown): HookRequest | null {
  const parsed = hookSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { user, sms } = parsed.data;
  const digits = (user.new_phone || user.phone || "").replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return { userId: user.id, to: digits, code: sms.otp, flow: user.new_phone ? "add_number" : "sign_in" };
}
