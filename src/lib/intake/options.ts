/**
 * The fixed answers the form offers. The ids are what the database stores
 * (see the Phase 1 migration), so change them only with a migration.
 * Tracks, age ranges, tribes and goals are not here: they come from the
 * catalogue tables so the office can edit them.
 */
export type Option<T extends string = string> = { id: T; label: string; description?: string };

export const GENDERS = [
  { id: "female", label: "Woman" },
  { id: "male", label: "Man" },
  { id: "undisclosed", label: "Prefer not to say" },
] as const satisfies readonly Option[];
export type Gender = (typeof GENDERS)[number]["id"];

export const CIRCLE_MIXES = [
  { id: "mixed", label: "Men and women together" },
  { id: "same_gender", label: "My own gender only" },
  { id: "no_preference", label: "Either is fine" },
] as const satisfies readonly Option[];
export type CircleMix = (typeof CIRCLE_MIXES)[number]["id"];

export const ZONES = [
  { id: "iganmu-surulere", label: "Iganmu, Surulere and nearby", description: "Close to The Covenant Nation" },
  { id: "mainland", label: "Lagos Mainland", description: "Yaba, Ikeja, Maryland, Ikorodu and around" },
  { id: "island-lekki", label: "Lagos Island and Lekki", description: "Victoria Island, Ikoyi, Lekki, Ajah" },
  { id: "other-nigeria", label: "Elsewhere in Nigeria", description: "Ogun, Abuja, Port Harcourt and beyond" },
  { id: "abroad", label: "Outside Nigeria", description: "Your Tribe will meet online" },
] as const satisfies readonly Option[];
export type Zone = (typeof ZONES)[number]["id"];

export const FAITH_JOURNEYS = [
  { id: "exploring", label: "Exploring", description: "I am still working out what I believe" },
  { id: "new", label: "New to following Jesus", description: "I recently gave my life to Christ, or I am just starting" },
  { id: "growing", label: "Growing", description: "I am learning, asking questions and building habits" },
  { id: "established", label: "Established", description: "I have walked with God for years" },
  { id: "leading", label: "Leading others", description: "I serve, teach or mentor in my church or community" },
] as const satisfies readonly Option[];
export type FaithJourney = (typeof FAITH_JOURNEYS)[number]["id"];

export const MEETING_MODES = [
  { id: "online", label: "Online", description: "On Sundays, from wherever I am" },
  { id: "in_person", label: "In person", description: "Near me, when a Tribe meets that way" },
  { id: "either", label: "Either works", description: "Whichever Tribe fits best" },
] as const satisfies readonly Option[];
export type MeetingMode = (typeof MEETING_MODES)[number]["id"];

export const MEETING_TIMES = [
  { id: "sunday-afternoon", label: "Sunday afternoon" },
  { id: "sunday-evening", label: "Sunday evening" },
  { id: "weeknight-evening", label: "Weeknight evening" },
  { id: "saturday-morning", label: "Saturday morning" },
] as const satisfies readonly Option[];
export type MeetingTime = (typeof MEETING_TIMES)[number]["id"];

export const BASELINES = [
  { value: 1, label: "Not started" },
  { value: 2, label: "Thinking about it" },
  { value: 3, label: "Making a start" },
  { value: 4, label: "Making progress" },
  { value: 5, label: "Almost there" },
] as const;

export type Lean = -1 | 0 | 1;

/**
 * Six this-or-that taps. The left side is stored as -1 and the right as 1;
 * tapping a chosen side again clears it back to 0 ("either").
 */
export const STYLE_PAIRS = [
  { key: "styleSocial", left: "A quiet one-to-one", right: "A lively group chat" },
  { key: "styleStructure", left: "See where it goes", right: "A clear plan" },
  { key: "styleOpenness", left: "Stick with what works", right: "Try something new" },
  { key: "styleDirectness", left: "Keep the peace", right: "Say what I think" },
  { key: "styleDisclosure", left: "Open up once I trust", right: "Open up quickly" },
  { key: "styleLearning", left: "Learn by doing", right: "Learn by talking it through" },
] as const;
export type StyleKey = (typeof STYLE_PAIRS)[number]["key"];

export const SERVING_OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "maybe", label: "Maybe later" },
  { id: "not_now", label: "Not now" },
] as const satisfies readonly Option[];
export type ServingInterest = (typeof SERVING_OPTIONS)[number]["id"];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Days in each month, counting 29 for February so no birthday is turned away. */
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Examples shown under the story box. They are prompts, not choices. */
export const STORY_EXAMPLES = [
  "I just lost my job and I'm trusting God for the next door.",
  "I run a small business and I'm tired of doing it alone.",
  "We have three children and our home needs a better rhythm.",
  "I'm a student and I want friends who love God.",
] as const;
