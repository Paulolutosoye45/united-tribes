/**
 * The fixed wording of the Leader Portal: the seven eligibility checks, the
 * calling questions, the referee form, and the rubrics reviewers score with.
 * The ids are stored with each application (see the Phase 2 migration), so
 * change an id only with a migration. The wording is a proposal for the
 * pastorate to approve before real applicants use it.
 */
import type { Option } from "@/lib/intake/options";

export const ELIGIBILITY = [
  { id: "member6", label: "Have you been part of The Covenant Nation for at least six months?" },
  { id: "foundation", label: "Have you completed Foundation of Faith?" },
  { id: "serving", label: "Do you serve in a unit, fellowship or group right now?" },
  { id: "age21", label: "Are you 21 or older?" },
  { id: "time", label: "Can you give 75 minutes a week for 12 weeks, plus about 10 hours of training?" },
  { id: "safeguarding", label: "Will you complete safeguarding training and sign the leader code of conduct?" },
  { id: "confidentiality", label: "Will you keep members’ information private, unless someone is at risk?" },
] as const satisfies readonly Option[];
export type EligibilityId = (typeof ELIGIBILITY)[number]["id"];
export const ELIGIBILITY_IDS = ELIGIBILITY.map((e) => e.id) as readonly EligibilityId[];

/** What to say to someone who answered “not yet”, and where to go instead. Kind, specific, never a dead end. */
export const ELIGIBILITY_ADVICE: Record<EligibilityId, string> = {
  member6: "Leaders have been part of the church for six months, so they know it from the inside. Join a tribe as a member now, and apply once the six months are done.",
  foundation: "Foundation of Faith is the base every leader stands on. Finish it, then come back and apply. Ask your unit head when the next class starts.",
  serving: "Leaders grow out of serving. Join a unit or fellowship, serve for a season, and apply again.",
  age21: "Leaders are 21 or older. You can join a tribe as a member, and serve as a helper in a unit while you grow.",
  time: "Leading takes about 75 minutes a week for twelve weeks. If this season is too full, join a tribe as a member, and apply in a lighter season.",
  safeguarding: "Safeguarding training and the code of conduct protect every member, so every leader completes them. If you have questions, speak to your unit head first.",
  confidentiality: "People share honestly only when they trust that it stays private. Every leader promises this, except where someone is at risk.",
};

export const OTHER_WAYS_TO_SERVE = [
  "Join a tribe as a member",
  "Serve in a unit or fellowship",
  "Ask your unit head about training",
] as const;

export const GOAL_RELATIONS = [
  { id: "achieved", label: "I have reached it", description: "I can tell the story of how" },
  { id: "pursuing", label: "I am working on it now", description: "I am honestly in the middle of it" },
] as const satisfies readonly Option[];
export type GoalRelation = (typeof GOAL_RELATIONS)[number]["id"];

export const LEAD_BEST = [
  { id: "structure", label: "Structure and preparation", description: "A clear plan, so people know what to expect" },
  { id: "connection", label: "Conversation and connection", description: "Listening, and drawing people out" },
  { id: "teaching", label: "Teaching and explaining", description: "Helping people understand and apply" },
  { id: "doing", label: "Doing things together", description: "Serving, practising, trying it side by side" },
] as const satisfies readonly Option[];
export type LeadBest = (typeof LEAD_BEST)[number]["id"];

/** Your walk with God, 1 to 5. The panel rewards honesty, not a high number. */
export const WALK_LABELS = [
  "Dry and distant",
  "Struggling",
  "Steady, with ups and downs",
  "Growing",
  "Close and thriving",
] as const;

/** How many characters a written answer needs before it counts. The database checks the same number. */
export const MIN_WRITTEN = 20;

/** Referees answer four questions, each from 1 to 5, and say whether they have any concern. */
export const REFEREE_QUESTIONS = [
  { id: "reliability", title: "Reliability", ask: "Does this person do what they say they will?" },
  { id: "warmth", title: "Warmth", ask: "Do people feel safe around them?" },
  { id: "confidentiality", title: "Trustworthiness", ask: "Can they be trusted with private matters?" },
  { id: "maturity", title: "Spiritual maturity", ask: "Is their faith steady and growing?" },
] as const;
export type RefereeQuestionId = (typeof REFEREE_QUESTIONS)[number]["id"];

export const REFEREE_SCALE = ["Not really", "Sometimes", "Usually", "Almost always", "Always"] as const;

export const REFEREE_RELATIONSHIPS = [
  "Pastor",
  "Unit head",
  "Fellowship leader",
  "Colleague at church",
  "Friend of many years",
  "Mentor",
] as const;

export type RubricQuestion = {
  id: string;
  title: string;
  /** What the applicant was asked, shortened. */
  looksAt: string;
  low: string;
  mid: string;
  high: string;
};

/** Stage 2: what two reviewers score, 1 to 5 each. */
export const CALLING_RUBRIC: readonly RubricQuestion[] = [
  {
    id: "q1",
    title: "Lived connection to the goal",
    looksAt: "The Season Goal they chose and their story",
    low: "No real link to the goal, or a general story",
    mid: "Some experience, but little that is specific",
    high: "Specific, honest experience: reached it or truly in it now",
  },
  {
    id: "q2",
    title: "Focus on others",
    looksAt: "Why they want to lead",
    low: "About a title, being seen or being needed",
    mid: "A mix of their own growth and others’",
    high: "Centred on helping others grow, with humility",
  },
  {
    id: "q3",
    title: "Walking with people",
    looksAt: "A time they walked with someone through a hard season",
    low: "Fixed things or gave advice; no sense of what not to do",
    mid: "Cared and stayed, but mostly did things for the person",
    high: "Listened, stayed, respected limits, and knows what not to do",
  },
  {
    id: "q4",
    title: "Honest about their own walk",
    looksAt: "Their 1 to 5 rating and the note beside it",
    low: "Polished or evasive; the rating and the note do not match",
    mid: "Some honesty about where they are",
    high: "Names real weak spots, and the rating fits the note",
  },
  {
    id: "q5",
    title: "Self-awareness about obstacles",
    looksAt: "What could get in the way of leading for 12 weeks",
    low: "Names nothing, or brushes it off",
    mid: "Names obstacles but not how they will handle them",
    high: "Names real obstacles, and who they would tell and what they would do",
  },
  {
    id: "q6",
    title: "Fit with track, community and goal",
    looksAt: "Whether their track, community and goal belong together",
    low: "The choices do not fit each other",
    mid: "A reasonable fit",
    high: "A clear fit; they could speak that group’s language",
  },
];

/** Stage 6: the five set questions, scored by the panel, 1 to 5 each. */
export const INTERVIEW_RUBRIC: readonly (RubricQuestion & { ask: string })[] = [
  {
    id: "q1",
    ask: "Tell us your story with the Season Goal you would lead.",
    title: "Their story with the goal",
    looksAt: "Whether it is real, specific and told without pride",
    low: "Vague or rehearsed",
    mid: "Real, but thin on detail",
    high: "Specific, honest, and about what they learned",
  },
  {
    id: "q2",
    ask: "Walk us through how you would run a first meeting.",
    title: "Running a first meeting",
    looksAt: "Welcome, safety, rhythm and time",
    low: "No plan, or a lecture",
    mid: "A plan, but the members are not at its centre",
    high: "Warm welcome, shared rules, everyone speaks, ends on time",
  },
  {
    id: "q3",
    ask: "What would you do if half your tribe stopped coming by week 5?",
    title: "When people drift",
    looksAt: "Care before pressure, and asking for help",
    low: "Blames people, or does nothing",
    mid: "Reaches out, but alone",
    high: "Calls with no guilt, listens, tells the coach, adjusts the tribe",
  },
  {
    id: "q4",
    ask: "Where do you most need to grow as a leader?",
    title: "Growth edge",
    looksAt: "Honesty and willingness to be coached",
    low: "A disguised strength, or nothing",
    mid: "Names a gap, with little openness",
    high: "A real gap and a clear way they are working on it",
  },
  {
    id: "q5",
    ask: "Who supports you, and how will you keep your own soul healthy this season?",
    title: "Support and soul care",
    looksAt: "Whether they will be looked after as they look after others",
    low: "Alone, and running on empty",
    mid: "Some support, no plan",
    high: "Named people and real rhythms of rest and prayer",
  },
];

/** The applicant’s tracker. Each status has one plain sentence and one next action. */
export type StatusInfo = { label: string; line: string };
export const STATUS_INFO: Record<string, StatusInfo> = {
  draft: { label: "In progress", line: "Your application is saved. Finish it whenever you are ready." },
  ineligible: { label: "Not this time", line: "There is another way to serve for now." },
  submitted: { label: "With the review panel", line: "Two reviewers read every application. Send your referees their links if you have not yet." },
  interview_invited: { label: "Choose your interview", line: "You have been invited. Pick a 20-minute time that suits you." },
  interview_booked: { label: "Interview booked", line: "Your interview is booked. Come as you are." },
  interviewed: { label: "Interviewed", line: "Thank you. A pastor will decide and you will see the result here." },
  approved_leader: { label: "Approved as a leader", line: "Welcome. Leader training is next." },
  approved_assistant: { label: "Approved as an assistant leader", line: "Welcome. You will serve beside a leader. Training is next." },
  not_approved: { label: "Not approved this time", line: "Thank you for offering. A pastor has left you a note." },
};

/** The stages as the applicant sees them on the tracker. */
export const STAGES = [
  { id: "apply", label: "Application", blurb: "Eight written answers and six situations. About fifteen minutes." },
  { id: "references", label: "References", blurb: "Two people who know you answer four short questions." },
  { id: "review", label: "Panel review", blurb: "Two reviewers read your application." },
  { id: "interview", label: "Interview", blurb: "A 20-minute conversation with two panelists." },
  { id: "decision", label: "Decision", blurb: "A pastor decides, and you see the result here." },
] as const;

/** How the review panel names each status. */
export const REVIEW_STATUS: Record<string, { label: string; tone: "neutral" | "gold" | "flame" | "charcoal" | "outline" }> = {
  submitted: { label: "New", tone: "flame" },
  interview_invited: { label: "Invited", tone: "gold" },
  interview_booked: { label: "Interview booked", tone: "gold" },
  interviewed: { label: "Ready to decide", tone: "charcoal" },
  approved_leader: { label: "Leader", tone: "neutral" },
  approved_assistant: { label: "Assistant leader", tone: "neutral" },
  not_approved: { label: "Not approved", tone: "outline" },
};

/** The words reviewers see beside each 1 to 5 score. */
export const SCORE_WORDS = ["Not evident", "Slight", "Some", "Clear", "Strong"] as const;
