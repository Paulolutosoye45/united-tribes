/**
 * Reading a phone number or an email the same way the database does. The database has the last word (it re-reads whatever it is
 * given), and tests/fixtures/referee-contacts.json is run against both, so the two cannot drift apart. This copy is for
 * the screens: saying what we understood before anything is saved.
 */

export type ContactKind = "email" | "phone";
export type Contact = { kind: ContactKind; norm: string };

/** A phone in international form (+234…), or null. Nigerian numbers may be written 0803…, 234803…, 803… (a spreadsheet drops the zero) or +234 (0)803…. */
export function normalisePhone(text: string | null | undefined): string | null {
  const x = String(text ?? "").replace(/[^0-9+]/g, "");
  if (/^\+2340\d{10}$/.test(x)) return `+234${x.slice(5)}`;
  if (/^002340\d{10}$/.test(x)) return `+234${x.slice(6)}`;
  if (/^\+[1-9]\d{7,14}$/.test(x)) return x;
  if (/^00[1-9]\d{7,14}$/.test(x)) return `+${x.slice(2)}`;
  if (/^0\d{10}$/.test(x)) return `+234${x.slice(1)}`;
  if (/^2340\d{10}$/.test(x)) return `+234${x.slice(4)}`;
  if (/^234\d{10}$/.test(x)) return `+${x}`;
  if (/^[789]\d{9}$/.test(x)) return `+234${x}`;
  return null;
}

export function normaliseEmail(text: string | null | undefined): string | null {
  const x = String(text ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(x) && !/@.*@/.test(x) ? x : null;
}

/** What the text is meant to be: an email if it has an @ after the first character, otherwise a phone. */
export function contactKind(text: string | null | undefined): ContactKind {
  return String(text ?? "").indexOf("@") > 0 ? "email" : "phone";
}

export function normaliseContact(text: string | null | undefined): Contact | null {
  const kind = contactKind(text);
  const norm = kind === "email" ? normaliseEmail(text) : normalisePhone(text);
  return norm ? { kind, norm } : null;
}

/** "+234 803 123 4567", as people write it. Other countries' numbers are shown as they came. */
export function prettyPhone(norm: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(norm);
  return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : norm;
}

/** The same masking the database applies for the referee's own page. */
export function maskContact(kind: ContactKind, norm: string | null): string | null {
  if (!norm) return null;
  if (kind === "email") {
    const [local, domain = ""] = norm.split("@");
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  return `${norm.slice(0, 4)} ••• ••• ${norm.slice(-3)}`;
}

/** Throwaway inboxes the database refuses. The database holds the same list (referee_blocked_domains); a test keeps them equal. */
export const BLOCKED_DOMAINS: readonly string[] = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de",
  "guerrillamailblock.com", "sharklasers.com", "grr.la", "10minutemail.com", "10minutemail.net", "20minutemail.com",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmailo.com", "tempr.email",
  "tempail.com", "tempinbox.com", "yopmail.com", "yopmail.fr", "yopmail.net", "trashmail.com",
  "trashmail.net", "throwawaymail.com", "getnada.com", "nada.email", "maildrop.cc", "dispostable.com",
  "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com", "spamgourmet.com",
  "moakt.com", "burnermail.io", "mytemp.email", "discard.email", "emltmp.com", "tmpmail.org",
  "tmail.ws", "harakirimail.com", "mailcatch.com", "mailsac.com", "inboxkitten.com", "minuteinbox.com",
  "dropmail.me", "1secmail.com", "1secmail.org", "1secmail.net", "fakemail.net", "mailtemp.info",
  "trbvm.com", "byom.de", "spambox.us", "mt2015.com", "wegwerfmail.de", "einrot.com",
  "cuvox.de",
];

export function isThrowawayEmail(email: string): boolean {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  return BLOCKED_DOMAINS.includes(domain);
}

/**
 * What the applicant is told while typing, before anything is saved. `null` means it looks usable. The database checks the
 * real rules (their own contact, the other referee, someone else's referee) and says so in words if one fails.
 */
export function contactProblem(text: string, own: readonly (string | null | undefined)[] = []): string | null {
  const t = text.trim();
  if (!t) return "Enter a phone number or an email address.";
  const c = normaliseContact(t);
  if (!c) return contactKind(t) === "email" ? "That doesn’t look like an email address." : "That doesn’t look like a phone number or email address. Try 0803 123 4567.";
  if (c.kind === "email" && isThrowawayEmail(c.norm)) return "Please use a personal or church email address, not a temporary one.";
  const mine = own.map((o) => normaliseContact(o ?? "")?.norm).filter(Boolean);
  if (mine.includes(c.norm)) return "A referee has to be someone else, not you.";
  return null;
}
