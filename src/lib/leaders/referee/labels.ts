/** The words the screens use for what the database knows. One place, so the applicant, the reviewer and the pastorate read the same. */

export type Standing = "pastor" | "unit_head" | "ministry_leader";
export const STANDINGS: readonly Standing[] = ["pastor", "unit_head", "ministry_leader"] as const;

export const STANDING_LABEL: Record<Standing, string> = { pastor: "Pastor", unit_head: "Unit head", ministry_leader: "Ministry leader" };
export const standingLabel = (s: string | null | undefined) => (s && s in STANDING_LABEL ? STANDING_LABEL[s as Standing] : "—");

/** How we know who a referee is. */
export type Verification = "unverified" | "contact" | "directory" | "pastor" | "disputed";

export const VERIFICATION_LABEL: Record<Verification, { short: string; long: string; tone: "good" | "info" | "warn" | "bad" }> = {
  unverified: { short: "Not verified", long: "This reference came in before referees were checked. We have not confirmed it was theirs.", tone: "warn" },
  contact: { short: "Verified contact", long: "They proved they hold the phone number or email the applicant gave. We do not know them from the church’s list.", tone: "info" },
  directory: { short: "On the church’s list", long: "They proved they hold the phone number or email on the church’s list of pastors and unit heads.", tone: "good" },
  pastor: { short: "Confirmed by a pastor", long: "A pastor confirmed this person is a pastor or unit head.", tone: "good" },
  disputed: { short: "Disowned", long: "They said this reference was not theirs. It is left out of the scores.", tone: "bad" },
};

/** What a flag means, in words a reviewer can act on. `kind` is what the database stores. */
export const FLAG_LABEL: Record<string, { title: string; help: string }> = {
  same_browser: { title: "Same browser as the applicant", help: "This was answered on a browser the applicant has signed in on. Phone the referee to check it was them." },
  same_network: { title: "Same network as the applicant", help: "This was answered from a network the applicant has used. That alone is common (a shared phone network or home wifi)." },
  too_fast: { title: "Finished very quickly", help: "The ratings were done in less time than it takes to read the questions." },
  identical_pattern: { title: "Same ratings as the other referee", help: "Both referees gave the same four ratings within half an hour." },
  text_like_applicant: { title: "Note reads like the applicant’s writing", help: "The concern note is very close to something the applicant wrote in their own answers." },
  many_networks: { title: "Opened from several places", help: "The link was opened from three or more different networks." },
  disowned: { title: "Referee says it was not them", help: "The person at this contact says they did not give this reference." },
};

/** Where a request has got to, as the applicant sees it. `stage` is what the database stores. */
export type Stage = "waiting" | "sending" | "sent" | "opened" | "verified" | "answered" | "unreachable";

export const STAGE_STEPS: { id: "sent" | "opened" | "verified" | "answered"; label: string }[] = [
  { id: "sent", label: "Sent" },
  { id: "opened", label: "Opened" },
  { id: "verified", label: "Confirmed it’s them" },
  { id: "answered", label: "Answered" },
];

const RANK: Record<Stage, number> = { waiting: 0, sending: 0, unreachable: 0, sent: 1, opened: 2, verified: 3, answered: 4 };

/** How many of the four steps are done. */
export const stageRank = (stage: string) => RANK[(stage in RANK ? stage : "waiting") as Stage];

/** One sentence for the applicant, never revealing more than the status. */
export function stageLine(stage: string, kind: "email" | "phone" | null, first: string): string {
  const where = kind === "email" ? "by email" : "by message";
  switch (stage) {
    case "sending":
      return `Sending ${first} their private link ${where}…`;
    case "sent":
      return `We sent ${first} a private link ${where}. They haven’t opened it yet.`;
    case "opened":
      return `${first} has opened the link. Waiting for them to confirm it’s really them.`;
    case "verified":
      return `${first} has confirmed it’s them and is answering now.`;
    case "answered":
      return `${first} has answered. Thank you.`;
    case "unreachable":
      return `We couldn’t reach ${first}. Check the number or email, or choose someone else.`;
    default:
      return `Nothing sent to ${first} yet.`;
  }
}

/** What an applicant may swap a referee after a request has gone out. The database holds the real number (settings) and refuses beyond it. */
export const MAX_CHANGES = 2;
