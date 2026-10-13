/**
 * What a parent or guardian is shown and agrees to, by their private link.
 *
 * Bump the version whenever the meaning of a sentence changes: the version a parent saw is stored with their answer.
 *
 * HAVE A LAWYER AND THE CHURCH'S SAFEGUARDING LEAD REVIEW THIS WORDING before the teen track is opened
 * (docs/TEENS.md). It must also match the church's child-protection policy and the Nigeria Data Protection Act,
 * which gives children's data extra protection.
 */
export const GUARDIAN_CONSENT_VERSION = "2026-12-g2";

/** What the parent or guardian is told, in order. Plain sentences; none of them promises more than the programme does. */
export const GUARDIAN_STATEMENTS = [
  "United Tribes is a programme of The Covenant Nation. Members meet in a small group of about twelve for twelve weeks, to pray, talk and take one small step toward a goal each week.",
  "A tribe for young people is led by two adults who have completed our leader training and been interviewed and approved by our pastors. There are always two adults present.",
  "We will only place your child in a tribe for their own age group. We will never place them in an adult tribe.",
  "Your child’s name, and the number they choose to share, will be seen by the leaders of their tribe, and by the coach and the Care Team who look after it.",
  "Once your child has a place, this same page shows you their tribe’s leaders, and the day, time and place it meets.",
  "A member of our Care Team will phone or write to you, using the details we were given, to check that this answer is really yours. Your child cannot be placed in a tribe until we have spoken to you.",
  "We use the answers your child gave about themselves, including their faith journey, only to match them to a tribe and to contact them about it. We do not share them outside the programme, and you can ask the Care Team to delete them.",
  "You can take your permission back at any time, by the same link. Your child will then leave the tribe straight away.",
  "We keep your contact details only for as long as they are needed for this, then delete them.",
] as const;

export const GUARDIAN_AGREE_SENTENCE =
  "I am this young person’s parent or legal guardian. I have read the above, and I give my permission for them to take part.";

export const RELATIONSHIPS: { id: "mother" | "father" | "guardian" | "other"; label: string }[] = [
  { id: "mother", label: "Mother" },
  { id: "father", label: "Father" },
  { id: "guardian", label: "Legal guardian" },
  { id: "other", label: "Another adult responsible for me" },
];

export function relationshipLabel(id: string | null | undefined): string {
  return RELATIONSHIPS.find((r) => r.id === id)?.label ?? "Parent or guardian";
}
