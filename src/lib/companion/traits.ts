/**
 * The vocabulary the Companion thinks in. A trait is one small thing it can learn about a person: that they work for
 * an employer, that they are preparing for marriage, that they like a clear plan. Everything else (communities, goals,
 * roles, times) is ranked by how well it fits the traits we have.
 *
 * `phrase` is how the Companion says a trait back when the person told it directly ("you’re married").
 * `chip` is the short label shown in "here is what I’m picking up"; traits without one are used quietly.
 * `tender` marks things that are painful or private. They may help rank a community or goal, but they are never shown
 * as a chip, never quoted back and never pre-selected: the person finds the gentle option in the list and decides.
 */
export type Kind = "work" | "field" | "relationship" | "children" | "place" | "topic" | "faith" | "role" | "style" | "serve" | "progress";

type Def = { kind: Kind; chip?: string; phrase?: string; tender?: true };

const T = {
  // How someone works
  employed: { kind: "work", chip: "Employed", phrase: "you’re employed" },
  self_employed: { kind: "work", chip: "Own business", phrase: "you run your own business" },
  consultant: { kind: "work", chip: "Independent", phrase: "you work independently" },
  between_jobs: { kind: "work", chip: "Between jobs", phrase: "you’re between jobs" },
  student: { kind: "work", chip: "Student", phrase: "you’re a student" },
  nysc: { kind: "work", chip: "NYSC", phrase: "you’re doing NYSC" },
  homemaker: { kind: "work", chip: "At home full time", phrase: "you’re at home full time" },
  retired: { kind: "work", chip: "Retired", phrase: "you’re retired" },

  // The field
  f_finance: { kind: "field", chip: "Banking and finance", phrase: "you work in banking and finance" },
  f_tech: { kind: "field", chip: "Technology", phrase: "you work in technology" },
  f_health: { kind: "field", chip: "Health and medicine", phrase: "you work in health and medicine" },
  f_education: { kind: "field", chip: "Education", phrase: "you work in education" },
  f_creative: { kind: "field", chip: "Creative and media", phrase: "you work in the creative world" },
  f_law_public: { kind: "field", chip: "Law and public service", phrase: "you work in law or public service" },
  f_engineering_trades: { kind: "field", chip: "Engineering and trades", phrase: "you work in engineering or the trades" },
  f_agriculture_food: { kind: "field", chip: "Farming and food", phrase: "you work in farming or food" },
  f_ministry_ngo: { kind: "field", chip: "Ministry and NGOs", phrase: "you work in ministry or an NGO" },
  f_trade_retail: { kind: "field", chip: "Trade and retail", phrase: "you work in trade or retail" },

  // Home life
  single: { kind: "relationship", chip: "Single", phrase: "you’re single" },
  courting: { kind: "relationship", chip: "In a relationship", phrase: "you’re in a relationship" },
  engaged: { kind: "relationship", chip: "Engaged", phrase: "you’re engaged" },
  married: { kind: "relationship", chip: "Married", phrase: "you’re married" },
  c_none: { kind: "children", chip: "No children", phrase: "you have no children" },
  c_expecting: { kind: "children", chip: "Expecting", phrase: "you’re expecting" },
  c_under_12: { kind: "children", chip: "Young children", phrase: "you have children under 12" },
  c_teens: { kind: "children", chip: "Teenagers", phrase: "you have teenagers" },
  c_adult: { kind: "children", chip: "Grown children", phrase: "your children are grown" },
  c_some: { kind: "children", phrase: "you have children" },

  // What is on their mind
  t_business: { kind: "topic", chip: "Business" },
  t_launch: { kind: "topic", chip: "Starting something" },
  t_grow: { kind: "topic", chip: "Growing a business" },
  t_career: { kind: "topic", chip: "Career" },
  t_leadership: { kind: "topic", chip: "Leading" },
  t_switch: { kind: "topic", chip: "A change of direction" },
  t_clients: { kind: "topic", chip: "Clients" },
  t_pricing: { kind: "topic", chip: "Pricing" },
  t_jobsearch: { kind: "topic" },
  t_skills: { kind: "topic", chip: "New skills" },
  t_abroad: { kind: "place", chip: "Abroad", phrase: "you’re based outside Nigeria" },
  t_move: { kind: "topic", chip: "A move" },
  t_distance: { kind: "topic", chip: "Family far away" },
  t_marriage: { kind: "topic", chip: "Marriage" },
  t_prep: { kind: "topic", chip: "Preparing for marriage" },
  t_rebuild: { kind: "topic", tender: true },
  t_parenting: { kind: "topic", chip: "Parenting" },
  t_home: { kind: "topic", chip: "Home life" },
  t_fitness: { kind: "topic", chip: "Fitness" },
  t_habit: { kind: "topic" },
  t_milestone: { kind: "topic" },
  t_health: { kind: "topic", chip: "Health" },
  t_study: { kind: "topic", chip: "Studies" },
  t_exam: { kind: "topic", chip: "Exams" },
  t_teach: { kind: "topic", chip: "Teaching" },
  t_burnout: { kind: "topic", tender: true },
  t_calling: { kind: "topic", chip: "Calling" },
  t_specialise: { kind: "topic", chip: "Specialising" },
  t_creative: { kind: "topic", chip: "Creative work" },
  t_release: { kind: "topic", chip: "Finishing a project" },
  t_income: { kind: "topic", chip: "Income" },

  // Walk with God, only when they say so
  faith_new: { kind: "faith" },
  faith_exploring: { kind: "faith" },
  faith_growing: { kind: "faith" },
  faith_established: { kind: "faith" },
  faith_leading: { kind: "faith", chip: "Serves in church" },
  serve_yes: { kind: "serve" },
  serve_not_now: { kind: "serve" },

  // The part they play in a group (the same eight as the form)
  role_encourager: { kind: "role" },
  role_organiser: { kind: "role" },
  role_host: { kind: "role" },
  role_thinker: { kind: "role" },
  role_peacemaker: { kind: "role" },
  role_prayer_warrior: { kind: "role" },
  role_truth_teller: { kind: "role" },
  role_connector: { kind: "role" },

  // How they like to work with people, only when they say so
  st_quiet: { kind: "style" },
  st_social: { kind: "style" },
  st_plan: { kind: "style" },
  st_flow: { kind: "style" },
  st_new: { kind: "style" },
  st_steady: { kind: "style" },
  st_direct: { kind: "style" },
  st_peace: { kind: "style" },
  st_open_fast: { kind: "style" },
  st_open_slow: { kind: "style" },
  st_doing: { kind: "style" },
  st_talking: { kind: "style" },

  // Where they are on their goal, only when they say so
  p_1: { kind: "progress" },
  p_2: { kind: "progress" },
  p_3: { kind: "progress" },
  p_4: { kind: "progress" },
  p_5: { kind: "progress" },
} as const satisfies Record<string, Def>;

export type Trait = keyof typeof T;
export const TRAITS: Record<Trait, Def> = T;
export const TRAIT_IDS = Object.keys(T) as Trait[];

export const isTrait = (value: string): value is Trait => Object.prototype.hasOwnProperty.call(T, value);
export const isTender = (trait: Trait): boolean => "tender" in T[trait] && T[trait].tender === true;
