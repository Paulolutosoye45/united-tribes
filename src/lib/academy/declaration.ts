/**
 * The safeguarding declaration a leader signs after the care and safeguarding
 * module. Bump the version when the meaning of a promise changes; the database
 * keeps who signed which version. Have the pastorate and counsel confirm the
 * wording before real leaders sign it.
 */
export const SAFEGUARDING_VERSION = "2026-11-s1";

export const SAFEGUARDING_PROMISES = [
  "I will keep what members share private, except where someone may be at risk of harm.",
  "I will never promise a member secrecy.",
  "If someone may be at risk, I will contact the Care Lead the same day. I will not investigate or confront anyone myself.",
  "I will not be alone with a child connected to my Tribe, in person or online.",
  "I will not lend, borrow or accept money from members of my Tribe. I will route money needs through the care ladder.",
  "I will keep members’ details and Tribe messages on the platform, and will not forward or store them anywhere else.",
  "I will treat every member with respect, and I will not use my role to pressure, exploit or form an inappropriate relationship with anyone.",
  "I will tell my coach if I cannot keep these promises, or if I see someone else breaking them.",
] as const;
