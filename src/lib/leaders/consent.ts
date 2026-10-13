/**
 * Wording on the leader application’s first screen. Bump the version when the
 * meaning of a sentence changes. Have a lawyer review the full text against
 * the Nigeria Data Protection Act before real applicants use it.
 *
 * Two wordings exist. The first one is what applicants agreed to before the first check on written answers; the
 * second adds that a computer program may read the written answers. The second is shown only once the first check
 * is switched to "shadow" or "on" (Admin > Leader quality), so while it is off nothing about the application changes.
 * The version the applicant agreed to is stored with the application; the database compares it with the version the
 * settings ask for (leader_ai_settings.consent_version), and only sends answers to an AI service for people who agreed
 * to the second.
 */
export const LEADER_CONSENT_VERSION = "2026-10-l1";
export const LEADER_CONSENT_VERSION_AI = "2026-12-l2";

export const LEADER_CONSENT =
  "I agree that The Covenant Nation’s review panel may read my application, ask my two referees about me, and keep a record of the review.";

export const LEADER_CONSENT_AI =
  "I agree that The Covenant Nation’s review panel may read my application, ask my two referees about me, and keep a record of the review. I also agree that a computer program (an AI service) may read my written answers, with phone numbers and email addresses removed and without my name, to check they are complete and to give the panel a first score. A person makes every decision. No application is turned down by a computer.";

/** The sentence and version to show and store, for the state of the first-check switch. */
export function leaderConsentFor(mode: "off" | "shadow" | "on" | string | null | undefined): { version: string; text: string } {
  return mode === "shadow" || mode === "on"
    ? { version: LEADER_CONSENT_VERSION_AI, text: LEADER_CONSENT_AI }
    : { version: LEADER_CONSENT_VERSION, text: LEADER_CONSENT };
}

export const REFEREE_NOTICE =
  "Your answers go only to the pastors and coaches who review leader applications. The person you are speaking about will not see your ratings or your note.";
