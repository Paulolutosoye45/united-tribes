import { STAGES } from "./options";

export type StageState = "done" | "current" | "later";

/** Statuses after the application is sent and before a decision. */
export const IN_REVIEW = ["submitted", "interview_invited", "interview_booked", "interviewed"] as const;
export const DECIDED = ["approved_leader", "approved_assistant", "not_approved"] as const;

export const isInReview = (status: string) => (IN_REVIEW as readonly string[]).includes(status);
export const isDecided = (status: string) => (DECIDED as readonly string[]).includes(status);

/**
 * Where the applicant is on the five-stage tracker. The panel can read the
 * application while references are still coming in, so “References” and
 * “Panel review” can both be in progress at once.
 */
export function stageStates(status: string, referencesAnswered: number): { id: (typeof STAGES)[number]["id"]; state: StageState }[] {
  const sent = status !== "draft" && status !== "ineligible";
  const invitedOrBeyond = ["interview_invited", "interview_booked", "interviewed", ...DECIDED].includes(status);
  const interviewed = ["interviewed", ...DECIDED].includes(status);
  const decided = isDecided(status);

  const states: Record<(typeof STAGES)[number]["id"], StageState> = {
    apply: sent ? "done" : "current",
    references: !sent ? "later" : referencesAnswered >= 2 ? "done" : "current",
    review: !sent ? "later" : invitedOrBeyond ? "done" : "current",
    interview: !invitedOrBeyond ? "later" : interviewed ? "done" : "current",
    decision: decided ? "done" : status === "interviewed" ? "current" : "later",
  };
  return STAGES.map((s) => ({ id: s.id, state: states[s.id] }));
}

const TITLES = new Set(["pastor", "pst", "pastors", "elder", "deacon", "deaconess", "sister", "brother", "bro", "sis", "mr", "mrs", "miss", "ms", "dr", "prof", "engr", "coach", "mama", "papa", "aunty", "uncle"]);

/** How to address someone by name: “Pastor Ife” for “Pastor Ife Adeyemi”, “Funmi” for “Funmi Balogun”. */
export function salutation(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "there";
  const first = parts[0].replace(/\.$/, "");
  if (TITLES.has(first.toLowerCase()) && parts[1]) return `${first} ${parts[1]}`;
  return first;
}

/**
 * A friendly heads-up the applicant may send a referee themselves. It has no link in it: the private link and the code come from
 * the system, to the referee's own phone or email, and the applicant never holds them.
 */
export function refereeHeadsUp(refereeName: string, applicantName = ""): string {
  const me = applicantName.trim() ? ` (${applicantName.trim()})` : "";
  return `Hello ${salutation(refereeName)}, it's me${me}. I'm applying to lead a small group (a tribe) at The Covenant Nation and I've given your name as a referee. You'll get a message from United Tribes with a private link and a code. It takes about two minutes. Thank you so much!`;
}

/** wa.me link: opens the referee’s chat when we have their number, otherwise lets the sender choose. */
export function whatsappLink(phoneE164: string | null, text: string): string {
  const digits = phoneE164 ? phoneE164.replace(/\D/g, "") : "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
