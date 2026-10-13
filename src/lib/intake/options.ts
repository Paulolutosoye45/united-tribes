/**
 * The fixed answers the form offers. The ids are what the database stores
 * (see the Phase 1 migration), so change them only with a migration.
 * Tracks, age ranges, communities and goals are not here: they come from the
 * catalogue tables so the office can edit them.
 */
export type Option<T extends string = string> = { id: T; label: string; description?: string };

export const GENDERS = [
  { id: "female", label: "Woman" },
  { id: "male", label: "Man" },
  { id: "undisclosed", label: "Prefer not to say" },
] as const satisfies readonly Option[];
export type Gender = (typeof GENDERS)[number]["id"];

export const TRIBE_MIXES = [
  { id: "mixed", label: "Men and women together" },
  { id: "same_gender", label: "My own gender only" },
  { id: "no_preference", label: "Either is fine" },
] as const satisfies readonly Option[];
export type TribeMix = (typeof TRIBE_MIXES)[number]["id"];

export const ZONES = [
  { id: "iganmu-surulere", label: "Iganmu, Surulere and nearby", description: "Close to The Covenant Nation" },
  { id: "mainland", label: "Lagos Mainland", description: "Yaba, Ikeja, Maryland, Ikorodu and around" },
  { id: "island-lekki", label: "Lagos Island and Lekki", description: "Victoria Island, Ikoyi, Lekki, Ajah" },
  { id: "other-nigeria", label: "Elsewhere in Nigeria", description: "Ogun, Abuja, Port Harcourt and beyond" },
  { id: "abroad", label: "Outside Nigeria", description: "Your tribe will meet online" },
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
  { id: "in_person", label: "In person", description: "Near me, when a tribe meets that way" },
  { id: "either", label: "Either works", description: "Whichever tribe fits best" },
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

// ---------------------------------------------------------------------------
// The smart form's "We heard…" questions. These ids match the checks in the database
// (supabase/migrations/20261203000100_intake_plus.sql), so change them only with a migration.
//
// `hint` is extra wording for the assistant only: everyday and Nigerian ways of saying the same thing,
// so "NYSC" and "side hustle" are understood. It is never shown to the member.
// `ai: false` marks an answer the assistant must never suggest, because guessing it would mean
// guessing at something painful. The member can still choose it.
// ---------------------------------------------------------------------------

export type HeardOption<T extends string = string> = Option<T> & { hint?: string; ai?: boolean };

export const RELATIONSHIPS = [
  { id: "single", label: "Single", hint: "not married, not dating, unmarried" },
  { id: "courting", label: "In a relationship", hint: "dating, courting, seeing someone, boyfriend, girlfriend" },
  { id: "engaged", label: "Engaged", hint: "preparing for marriage, getting married soon, fiance, fiancee, introduction, wedding planned" },
  { id: "married", label: "Married", hint: "husband, wife, spouse, my partner at home" },
  { id: "widowed", label: "Widowed", ai: false },
  { id: "separated", label: "Separated or divorced", ai: false },
] as const satisfies readonly HeardOption[];
export type Relationship = (typeof RELATIONSHIPS)[number]["id"];

export const CHILDREN = [
  { id: "none", label: "No children", hint: "no kids, childless" },
  { id: "expecting", label: "Expecting", hint: "pregnant, a baby on the way, expecting our first" },
  { id: "under_12", label: "Children under 12", hint: "kids, toddlers, small children, a baby, primary school, pikin" },
  { id: "teens", label: "Teenagers", hint: "teenage son or daughter, secondary school, adolescent" },
  { id: "adult", label: "Grown children", hint: "adult children, my children have left home, grandchildren" },
] as const satisfies readonly HeardOption[];
export type ChildrenKind = (typeof CHILDREN)[number]["id"];

export const WORK_STATUSES = [
  { id: "employed", label: "Employed", hint: "a job, work for a company, bank, civil servant, staff, promotion, manager" },
  { id: "self_employed", label: "Own business", hint: "business owner, entrepreneur, freelance, side hustle, self-employed, consultant, run a shop" },
  { id: "student", label: "Student", hint: "university, school, studying, undergraduate, postgraduate, final year" },
  { id: "nysc", label: "NYSC corps member", hint: "youth corps, serving, NYSC, corper, orientation camp" },
  { id: "between_jobs", label: "Between jobs", hint: "looking for work, job hunting, laid off, retrenched, lost my job, next door" },
  { id: "homemaker", label: "Full-time at home", hint: "stay-at-home, home-maker, raising children full time" },
  { id: "retired", label: "Retired", hint: "pension, retirement, retired from service" },
] as const satisfies readonly HeardOption[];
export type WorkStatus = (typeof WORK_STATUSES)[number]["id"];

export const WORK_FIELDS = [
  { id: "finance", label: "Banking and finance", hint: "bank, fintech, accounting, insurance, audit, investment" },
  { id: "tech", label: "Technology", hint: "software, developer, IT, data, product, startup, engineer in tech" },
  { id: "health", label: "Health and medicine", hint: "doctor, nurse, pharmacist, hospital, medical, clinic" },
  { id: "education", label: "Education", hint: "teacher, lecturer, school, university staff, tutor" },
  { id: "creative", label: "Creative and media", hint: "music, design, film, writing, fashion, content, photography, artist" },
  { id: "law_public", label: "Law, government and public service", hint: "lawyer, civil service, ministry, politics, police, army" },
  { id: "engineering_trades", label: "Engineering, building and trades", hint: "engineer, construction, oil and gas, mechanic, electrician, architect" },
  { id: "agriculture_food", label: "Farming and food", hint: "farm, agriculture, catering, restaurant, food business" },
  { id: "ministry_ngo", label: "Ministry and NGOs", hint: "pastor, church staff, missions, charity, non-profit" },
  { id: "trade_retail", label: "Trade and retail", hint: "market, shop, import, sales, distribution, supply" },
  { id: "other", label: "Something else" },
] as const satisfies readonly HeardOption[];
export type WorkField = (typeof WORK_FIELDS)[number]["id"];

export const GROUP_ROLES = [
  { id: "encourager", label: "Encourager", description: "I lift people up", hint: "cheer others on, motivate, positive, supportive" },
  { id: "organiser", label: "Organiser", description: "I keep us on track", hint: "plan, schedule, coordinate, keep time, administrator" },
  { id: "host", label: "Host", description: "I make people feel at home", hint: "hospitality, cook, welcome people, open my house, food" },
  { id: "thinker", label: "Thinker", description: "I ask the deeper questions", hint: "reflect, analyse, read, question, study, research" },
  { id: "peacemaker", label: "Peacemaker", description: "I calm things down", hint: "reconcile, mediate, listen, patient, keep the peace" },
  { id: "prayer_warrior", label: "Prayer warrior", description: "I carry people in prayer", hint: "intercessor, pray, fasting, prayer group" },
  { id: "truth_teller", label: "Truth-teller", description: "I say it kindly and straight", hint: "honest, direct, speak up, challenge, accountability" },
  { id: "connector", label: "Connector", description: "I bring people together", hint: "networker, introduce people, community, mobilise, organise gatherings" },
] as const satisfies readonly HeardOption[];
export type GroupRole = (typeof GROUP_ROLES)[number]["id"];

/** Up to two. */
export const MAX_GROUP_ROLES = 2;

/** How the assistant is shown an option: the label, plus any everyday wording that means the same. */
export const aiLabel = (o: { label: string; hint?: string }) => (o.hint ? `${o.label} (${o.hint})` : o.label);

/** What the assistant may suggest for a question: every option except those marked `ai: false`. */
export const aiOptions = (list: readonly HeardOption[]) =>
  list.filter((o) => o.ai !== false).map((o) => ({ id: o.id, label: aiLabel(o) }));

/**
 * Things that would help a tribe care for someone well. Only the member ever picks these (never the
 * assistant), and they are sealed before they are stored. `heavy` ones count toward the limit of two
 * members per tribe who are carrying a hard season; the others are things a tribe can simply arrange.
 */
export const SUPPORT_CHIPS = [
  { id: "access", label: "Step-free access, or a seat near the door", heavy: false },
  { id: "hearing_sight", label: "Help hearing or seeing", heavy: false },
  { id: "quiet", label: "A quieter, smaller tribe", heavy: false },
  { id: "childcare", label: "Somewhere for my children when we meet", heavy: false },
  { id: "costs", label: "Help with data or transport costs", heavy: false },
  { id: "grief", label: "I am grieving", heavy: true },
  { id: "home_strain", label: "Things are hard at home", heavy: true },
  { id: "low_mood", label: "I am anxious or low", heavy: true },
  { id: "recovery", label: "I am recovering from an addiction", heavy: true },
  { id: "job_money", label: "Job loss or money pressure", heavy: true },
  { id: "illness", label: "Ill health, mine or someone close to me", heavy: true },
] as const satisfies readonly { id: string; label: string; heavy: boolean }[];
export type SupportChip = (typeof SUPPORT_CHIPS)[number]["id"];

export const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", description: "Reminders, your Friday check-in and messages from your tribe" },
  { id: "email", label: "Email", description: "To your sign-in address" },
  { id: "sms", label: "Text message", description: "A short text with a link, if WhatsApp isn’t an option" },
] as const satisfies readonly Option[];
export type Channel = (typeof CHANNELS)[number]["id"];
