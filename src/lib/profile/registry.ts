/**
 * The facts the platform keeps about a person, and every place that reads them.
 *
 * One fact, one owner, many readers: the owner is the person the fact is about (the office only proposes); the readers are the places listed
 * here. Nothing else may read these facts. tests/db/profile-readers.test.ts scans the database's functions and the application's source for
 * each fact and fails when a place reads a fact and is not on this list (a new reader must be added here, with what it uses the fact for, in the
 * same change that adds it) and when a place on the list no longer reads it. The same test checks that this list agrees with the database's own
 * registry (supabase/migrations/20270101000100_profiles_stage1.sql) on which facts exist, who they apply to and how a change is handled.
 *
 * The file is also the source of docs/PROFILE-READERS.md, which `npm run readers` writes.
 *
 *   owner   the facts store itself: it asks, records and shows the fact
 *   reader  something else that reads it
 */

export type FactKey = "life_stage" | "age_range";
export type ChangeClass = "A" | "B" | "C" | "D";
export type Reader = { kind: "owner" | "reader"; name: string; use: string };

export type FactEntry = {
  key: FactKey;
  label: string;
  layer: "facts" | "story" | "role";
  changeClass: ChangeClass;
  appliesTo: ("leader" | "member")[];
  /** Where the value is held today, in words. */
  heldIn: string;
  /** Text that marks a database function as a reader (a regular expression, in the form both Postgres and JavaScript read the same way). */
  dbPattern: string;
  /** Text that marks a file of the application's source as a reader. */
  appPattern: string;
  /** Database functions that read it. */
  db: Reader[];
  /** Files under src/ that read it. */
  app: Reader[];
};

const owner = (name: string, use: string): Reader => ({ kind: "owner", name, use });
const reader = (name: string, use: string): Reader => ({ kind: "reader", name, use });

export const FACTS: FactEntry[] = [
  {
    key: "life_stage",
    label: "Stage of life",
    layer: "facts",
    changeClass: "C",
    appliesTo: ["leader"],
    heldIn: "the leader's tribe (its track), the answer on the leader's application, the office's short form at the appointment; and, once confirmed, the facts store",
    dbPattern: "track_id|calling,track|form ->> 'track'|life_stage",
    appPattern: "life_stage|lifeStage|calling\\.track|trackId|track_id",
    db: [
      owner("details_plan_rows", "works out who a Details Check would ask about their stage of life, and who is left out and why"),
      owner("feature_held_back", "keeps anyone in a tribe on a teen track out of the hold-out group (a tribe's track says whether its people are under 18)"),
      owner("messages_welcome_confirm", "adds the 'Confirm your details' line to the leader's welcome email while the stage is unconfirmed"),
      owner("profile_fact_answer", "records the leader's answer about their stage and decides what the change does (free, noted, reviewed)"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the stage as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_label", "gives a stage its words"),
      owner("profile_fact_options", "lists the stages a leader may choose from"),
      owner("profile_stage_confirmed", "says whether the leader has confirmed their stage (the hold on a Tribe Card reads this)"),
      owner("stage_review_decide", "applies or declines a reviewed change to a leader's stage"),
      owner("tribe_stage_status", "shows the pastor the leader's stage beside the card's"),
      reader("admin_catalogue", "lists the tracks the admin can open or close"),
      reader("assistant_tribe_young", "tells whether a tribe is the teen track, which changes who may assist"),
      reader("church_views", "groups the pastors' counts of tribes and members by track"),
      reader("dashboard_core", "groups the dashboard's tribes by track"),
      reader("export_leaders_roster", "puts each leader's track in the leaders' roster file"),
      reader("god_appoint_leader", "starts the appointed leader's tribe on the track the office suggested"),
      reader("god_appointment_inputs", "reads and checks the office's suggested track on the appointment form"),
      reader("god_person", "shows the owner a person's tribe and track"),
      reader("god_start_leader_card", "starts a tribe for an approved leader on the track in their application"),
      reader("intake_stats", "counts joiners by track"),
      reader("leader_ai_list", "shows the track from each application in the panel's list"),
      reader("leader_fit_inputs", "gives the leader fit model the track from the application"),
      reader("leader_offer_respond", "starts the tribe on the application's track when a leader accepts"),
      reader("match_candidates", "lists the tribes a member may be placed in, by the member's track"),
      reader("match_card", "shows a tribe's track on its match card"),
      reader("match_me", "chooses the member's tribes from the track their age range belongs to"),
      reader("match_stats", "counts tribes and places by track"),
      reader("multiplication_board", "groups tribes by track for the multiplication board"),
      reader("my_tribe", "tells the leader their card is missing a track"),
      reader("placement_candidates", "the placement run's list of tribes for a member, by track"),
      reader("placement_run_approve", "checks teen-track rules when a placement run is approved"),
      reader("review_queue", "shows the track from each application in the panel's queue"),
      reader("save_tribe_card", "saves the track a leader chooses on their Tribe Card"),
      reader("start_tribe_card", "starts a leader's draft card on the track in their application"),
      reader("submit_tribe_card", "refuses to submit a card with no track"),
      reader("suggest_assistants", "ranks possible assistants higher when their track matches the tribe's"),
      reader("tribe_json", "puts the tribe's track in the tribe's card as everyone reads it"),
      reader("tribe_queue", "shows each card's track in the pastor's queue"),
      reader("worker_pending_leader_jobs", "gives the sending service each leader's track for their messages"),
    ],
    app: [
      owner("src/app/(app)/my/actions.ts", "My page: the leader answers about their stage"),
      owner("src/app/(public)/details/[token]/actions.ts", "the private page: the leader answers about their stage"),
      owner("src/components/god/DetailsConsole.tsx", "the owner's Details Check console: which fact to ask about"),
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
      owner("src/lib/profile/wording.ts", "the words of each stage and each way a change ends"),
      reader("src/components/leaders/ApplySteps.tsx", "the leader's application asks for a track"),
      reader("src/lib/ai/sensitive.ts", "words the assistant treats as sensitive"),
    ],
  },
  {
    key: "age_range",
    label: "Age range",
    layer: "facts",
    changeClass: "C",
    appliesTo: ["member"],
    heldIn: "the member's profile (their answer on the joining form); and, once confirmed, the facts store",
    dbPattern: "age_range_id|age_ranges|age_range",
    appPattern: "age_range_id|ageRange|age_range|age_ranges",
    db: [
      owner("details_plan_rows", "works out who a Details Check would ask about their age range; people under 18 are never asked"),
      owner("profile_fact_answer", "records a member's answer about their age range and decides what the change does"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the age range as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_label", "gives an age range its words"),
      owner("profile_fact_options", "lists the age ranges a member may choose from"),
      owner("stage_review_decide", "applies or declines a reviewed change (a member's age range never needs one today)"),
      reader("activity_build_people", "groups people by age range in the activity report"),
      reader("admin_catalogue", "lists each track's age ranges for the admin"),
      reader("church_views", "counts members by age range for the pastors' views"),
      reader("export_my_data", "gives a person their own age range in their data file"),
      reader("god_person", "shows the owner a person's age range"),
      reader("intake_stats", "counts joiners by age range"),
      reader("is_minor", "decides whether a member is under 18, which is the rule for young people everywhere"),
      reader("match_candidates", "finds the member's track from their age range to choose tribes"),
      reader("match_me", "finds the member's track from their age range to choose tribes"),
      reader("message_blocker", "stops messages to members under 18"),
      reader("notice_is_young", "stops notices to members under 18"),
      reader("placement_candidates", "the placement run's list of tribes for a member, by the track of their age range"),
      reader("placement_run_approve", "checks the young people's rules when a placement run is approved"),
      reader("profile_teen_guard", "refuses a profile change that would cross the line between under and over 18"),
    ],
    app: [
      owner("src/app/(app)/my/actions.ts", "My page: the member answers about their age range"),
      owner("src/app/(public)/details/[token]/actions.ts", "the private page: the member answers about their age range"),
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
      owner("src/lib/profile/wording.ts", "the words of each age range and each way a change ends"),
      reader("src/app/(focus)/join/actions.ts", "the joining form saves the member's age range"),
      reader("src/components/intake/IntakeFlow.tsx", "the joining form: the step that asks"),
      reader("src/components/intake/JoinedView.tsx", "the page after joining shows the answer"),
      reader("src/components/intake/StepsRhythm.tsx", "the joining form's steps"),
      reader("src/components/intake/StepsYou.tsx", "the joining form asks for the age range"),
      reader("src/components/intake/types.ts", "the joining form's shapes"),
      reader("src/components/intake/useCompanion.ts", "the companion beside the form reads the age range"),
      reader("src/lib/companion/profile.ts", "the companion's picture of the member"),
      reader("src/lib/companion/sentences.ts", "the companion's sentences use the age range"),
      reader("src/lib/intake/answers.ts", "the joining form's answers"),
      reader("src/lib/intake/server.ts", "saves the joining form"),
      reader("src/lib/intake/steps.ts", "the joining form's steps and options"),
    ],
  },
];

export const FACT_KEYS = FACTS.map((f) => f.key);

const CLASS_WORDS: Record<ChangeClass, string> = {
  A: "A, free: saved at once, nothing else moves",
  B: "B, noted: saved at once, the next list of suggested tribes is worked out again, nobody is moved",
  C: "C, reviewed: for a person in a tribe or leading one it waits for the pastor of their centre, and the old value stays in force until then",
  D: "D, special: crossing 17 and 18 goes through the young people's rules or the office, never self-service",
};

/** docs/PROFILE-READERS.md, written from the list above by `npm run readers`. A test fails when the file on disk is not this. */
export function readersMarkdown(): string {
  const table = (rows: Reader[], what: string) =>
    rows.length === 0
      ? ""
      : [`| ${what} | Role | What it uses the fact for |`, "| --- | --- | --- |", ...rows.map((r) => `| \`${r.name}\` | ${r.kind === "owner" ? "owner" : "reader"} | ${r.use} |`), ""].join("\n");
  const out = [
    "# Who reads what a person has told us",
    "",
    "*Written by `npm run readers` from `src/lib/profile/registry.ts`. Do not edit it here; change the list in the source and run the command again.*",
    "",
    "One fact, one owner, many readers. The owner of a fact is the person it is about: the office only proposes, and the person confirms. The readers are the places",
    "listed below. A test (`tests/db/profile-readers.test.ts`) scans every database function and every file under `src/` for each fact and fails when a place reads a fact",
    "and is not listed here, or is listed and no longer reads it, so a new reader cannot be added without being written down, with what it uses the fact for.",
    "",
  ];
  for (const f of FACTS) {
    out.push(
      `## ${f.label} (\`${f.key}\`)`,
      "",
      `- Applies to: ${f.appliesTo.join(" and ")}`,
      `- Change class: ${CLASS_WORDS[f.changeClass]}`,
      `- Held today in: ${f.heldIn}`,
      `- Found by scanning for: \`${f.dbPattern}\` in database functions and \`${f.appPattern}\` in source files`,
      "",
      `### Database functions (${f.db.length})`,
      "",
      table(f.db, "Function"),
      `### Source files (${f.app.length})`,
      "",
      table(f.app, "File"),
    );
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
