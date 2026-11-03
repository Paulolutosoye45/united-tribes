/**
 * Wording shown on the consent step. Bump the version whenever the meaning of
 * a sentence changes, so the ledger records which wording each person saw.
 * Have a lawyer review the full text against the Nigeria Data Protection Act
 * before real members use it.
 */
export const CONSENT_VERSION = "2026-12-v4";

export const MATCHING_CONSENT =
  "I agree that The Covenant Nation may use my answers, including my faith journey, to match me to a tribe and to contact me about it.";

export const AI_CONSENT =
  "I agree that what I write or say about my season may be read by an AI service so it can suggest options and draft a sentence for me. A voice note is turned into words and the recording is deleted straight away. Contact details are removed first, and my private notes and the rest of my profile stay out of it.";

/**
 * Optional, and it opens nothing by itself. A leader sees a church-placed member's name at once; their email and WhatsApp number are given only
 * after the member presses "Yes, I'm in", whether or not this is ticked. Ticking it records that they are happy for that to happen.
 */
export const TEAM_CONTACT_CONSENT =
  "If the church places me in a tribe, my leader may be given my email and my WhatsApp number (if I gave one) once I press “Yes, I’m in”, so they can say hello.";

export const WHATSAPP_CONSENT = "You may message me on WhatsApp about my tribe.";
