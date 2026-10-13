import { normalisePhone } from "@/lib/auth/phone";

export type Preferred = "whatsapp" | "email" | "sms";

export type Contact = {
  email: string | null;
  phone: string | null;
  preferred: Preferred;
  whatsapp: boolean;
  sms: boolean;
  email_ok: boolean;
};

export type ContactInput = { phone: string | null; preferred: Preferred; whatsapp: boolean; sms: boolean; email: boolean };

/** Reads the database's answer defensively. */
export function readContact(data: unknown): Contact {
  const v = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const preferred = v.preferred === "email" || v.preferred === "sms" ? v.preferred : "whatsapp";
  return {
    email: typeof v.email === "string" ? v.email : null,
    phone: typeof v.phone === "string" ? v.phone : null,
    preferred,
    whatsapp: v.whatsapp === true,
    sms: v.sms === true,
    email_ok: v.email_ok !== false,
  };
}

/**
 * Checks the contact form before it goes to the database. The database checks again:
 * this is only to give a clear sentence quickly.
 */
export function parseContactForm(form: FormData): { ok: true; value: ContactInput } | { ok: false; message: string } {
  const rawPhone = String(form.get("phone") ?? "").trim();
  const phone = rawPhone ? normalisePhone(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, message: "That number doesn’t look right. Include your network code, like 0803 123 4567." };

  const whatsapp = form.get("whatsapp") === "on";
  const sms = form.get("sms") === "on";
  const email = form.get("email") === "on";
  if ((whatsapp || sms) && !phone) return { ok: false, message: "Add a phone number to be reached on WhatsApp or by text message." };
  if (!whatsapp && !sms && !email) {
    return { ok: false, message: "Keep at least one way we can reach you, or reply to a message from your leader to say you’d rather not be contacted." };
  }

  const asked = String(form.get("preferred") ?? "");
  const allowed = ([whatsapp ? "whatsapp" : null, email ? "email" : null, sms ? "sms" : null] as const).filter((x): x is Preferred => x !== null);
  const preferred = (allowed as string[]).includes(asked) ? (asked as Preferred) : allowed[0];
  return { ok: true, value: { phone, preferred, whatsapp, sms, email } };
}
