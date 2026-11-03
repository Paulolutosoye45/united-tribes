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
 *   owner   added by the profiles work (the facts store and the switchboard): it asks, records, shows or finds by the fact
 *   reader  something else that reads it
 */

export type FactKey = "life_stage" | "age_range" | "preferred_name" | "area" | "birthday" | "about_me" | "gifts" | "ask_me" | "pray_for_me";
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
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
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
      reader("placement_one_check", "warns the owner when the tribe's track is not the track of the person's age range, before one person is placed"),
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
      owner("my_office_ask", "takes a person's request to the office to change an age range across the line between 17 and 18 (never self-service)"),
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_answer", "records a member's answer about their age range and decides what the change does"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the age range as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
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
      reader("placement_one_check", "compares the person's age range track with the tribe's before one person is placed"),
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
  {
    key: "preferred_name",
    label: "Name we use for you",
    layer: "facts",
    changeClass: "A",
    appliesTo: ["leader", "member"],
    heldIn: "the person's own record (the name they asked to be called)",
    dbPattern: "preferred_name",
    appPattern: "preferredName|preferred_name",
    db: [
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the name as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
      reader("activity_audit", "shows the name in the activity audit when a person has no full name"),
      reader("activity_funnel_people", "shows the name in the funnel's list of people when a person has no full name"),
      reader("activity_stakeholders", "shows the name of the person behind a count when there is no full name"),
      reader("export_my_data", "puts the name in the data file a person downloads about themselves"),
      reader("find_people", "finds a person by the name they asked to be called, and shows it"),
      reader("first_name_of", "gives the name used first in every message, notice and greeting"),
      reader("god_appoint_leader", "greets the leader being appointed by the name they asked to be called"),
      reader("god_appointment_find", "finds a person to appoint by the name they use"),
      owner("god_feature_find", "finds a person for the switchboard by the name they use"),
      reader("god_feed", "names who did something in the owner's feed when there is no full name"),
      reader("god_people", "finds and lists people for the owner by the name they use"),
      reader("god_person", "shows the owner the name a person asked to be called"),
      reader("god_start_leader_card", "greets the leader whose tribe is being started by the name they use"),
      reader("handle_new_user", "saves the name from the sign-in provider on the person's record when they first arrive"),
      reader("leader_goal_guard", "names the leader in the message about their season goal"),
      reader("leader_offer_respond", "greets the leader accepting an offer by the name they use"),
      reader("person_display_name", "gives every list and page the one display name for a person"),
      reader("signin_admin_overview", "names who signed in, in the admin overview"),
      reader("start_tribe_card", "puts the leader's first name on the new tribe card"),
      reader("swap_members", "finds a member to swap by the name they use"),
    ],
    app: [
      reader("src/app/(app)/actions.ts", "saves the name a person types on their profile"),
      reader("src/app/(app)/admin/people/page.tsx", "shows the admin each person's name"),
      reader("src/app/(app)/god/conversations/page.tsx", "names the person in the owner's conversations"),
      reader("src/app/(app)/god/people/[id]/page.tsx", "names the person on the owner's page about them"),
      reader("src/app/(app)/home/page.tsx", "greets the person on Home"),
      reader("src/app/(app)/lead/page.tsx", "names the applicant when they ask their referees"),
      reader("src/app/(app)/lead/hand/page.tsx", "signs the words a leader sends by WhatsApp from their own phone with their first name"),
      reader("src/app/(app)/lead/week/page.tsx", "signs the leader's week with their name"),
      reader("src/app/(app)/profile/page.tsx", "names the person beside their photo"),
      reader("src/app/(app)/review/rhythm/page.tsx", "signs the Care Team's review with the reviewer's name"),
      reader("src/app/(app)/tribe/page.tsx", "names the young person on the page that tells them to wait"),
      reader("src/app/(focus)/join/actions.ts", "the joining form saves the name"),
      reader("src/app/(focus)/join/page.tsx", "the joining form starts from the name already held"),
      reader("src/app/(focus)/lead/apply/page.tsx", "greets the person starting a leader application"),
      reader("src/components/intake/IntakeFlow.tsx", "the joining form passes the name to its steps"),
      reader("src/components/intake/JoinedView.tsx", "the page after joining greets the person by name"),
      reader("src/components/intake/StepsRhythm.tsx", "the joining form's summary shows the name"),
      reader("src/components/intake/StepsYou.tsx", "the joining form asks for the name"),
      reader("src/components/shell/AppShell.tsx", "the account menu shows the name"),
      reader("src/lib/auth/session.ts", "puts the name on the signed-in person every page reads"),
      reader("src/lib/god/types.ts", "the shape of a person on the owner's pages"),
      reader("src/lib/intake/answers.ts", "the joining form's rules for the name"),
      reader("src/lib/intake/server.ts", "loads and saves the joining form with the name"),
      reader("src/lib/intake/steps.ts", "the joining form's step for the name"),
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
    ],
  },
  {
    key: "area",
    label: "Area",
    layer: "facts",
    changeClass: "B",
    appliesTo: ["member"],
    heldIn: "the member's profile (their answer on the joining form: one of five areas, and a short note)",
    // The member's own area, not a tribe's: a tribe has a zone of its own (c.zone, card.zone), which is a different fact held by a different owner.
    dbPattern: "(^|[^a-z_])(mp|me|prof|ap|r)\\.zone([^a-z_]|$)|area_note|when 'area' then|p_key = 'area'",
    appPattern: "answers\\.zone|areaNote|areaSlug|area_note|form\\.zone|options\\.zone|input\\.zone|profile\\.zone|area\\.zone|live\\.zone|row\\.zone|context\\.zone|\\ba\\.zone",
    db: [
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the area as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_label", "gives an area its words"),
      owner("profile_fact_options", "lists the five areas a member may choose from"),
      owner("profile_fact_save", "saves what the person chose, in the place the platform already reads it from"),
      reader("activity_build_people", "copies each member's area into the activity report's people table"),
      reader("activity_compare", "compares groups by area in the activity report"),
      reader("activity_funnels", "counts the joining funnel by area"),
      reader("activity_member_rows", "lists each member's area for the activity report"),
      reader("god_person", "shows the owner a member's area"),
      reader("match_candidates", "keeps in-person tribes close to the member and scores a nearer area higher"),
      reader("match_me", "saves the member's area with the list of tribes suggested for them"),
      reader("placement_candidates", "the placement run's list of tribes for a member, close to where they are"),
      reader("placement_run_approve", "carries the member's area into the placement when a run is approved"),
      reader("placement_run_new", "lets the office start a placement run for one area"),
    ],
    app: [
      reader("src/app/(app)/god/people/[id]/page.tsx", "shows the owner a member's area beside how they like to meet"),
      reader("src/app/(app)/god/placement/actions.ts", "lets the office start a placement run for one area"),
      reader("src/app/(focus)/join/actions.ts", "the joining form saves the area and the note"),
      reader("src/components/intake/AreaInput.tsx", "the joining form's area picker"),
      reader("src/components/intake/IntakeFlow.tsx", "the joining form suggests meeting times from the area"),
      reader("src/components/intake/StepsHeard.tsx", "the joining form fills the area when a place is picked"),
      reader("src/components/intake/StepsRhythm.tsx", "the joining form's summary shows where the person is based"),
      reader("src/components/intake/StepsYou.tsx", "the joining form asks where the person is based"),
      reader("src/components/intake/useCompanion.ts", "the companion beside the form reads the area"),
      reader("src/lib/companion/plan.ts", "the companion's plan uses the area"),
      reader("src/lib/companion/profile.ts", "the companion's picture of the member includes the area"),
      reader("src/lib/companion/rank.ts", "the companion ranks tribes by how close they are to the area"),
      reader("src/lib/intake/answers.ts", "the joining form's rules for the area"),
      reader("src/lib/intake/server.ts", "loads and saves the joining form with the area"),
      reader("src/lib/intake/steps.ts", "the joining form's step for the area"),
    ],
  },
  {
    key: "birthday",
    label: "Birthday",
    layer: "facts",
    changeClass: "A",
    appliesTo: ["member"],
    heldIn: "the member's profile (the day and month, from the joining form)",
    dbPattern: "birthday",
    appPattern: "birthday",
    db: [
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the day and month as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_label", "writes a birthday in words, day then month"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
      reader("run_calendar", "tells the leader the day before a member's birthday"),
      reader("tribe_week", "puts a member's birthday in the leader's week"),
    ],
    app: [
      reader("src/app/(focus)/join/actions.ts", "the joining form saves the day and month"),
      reader("src/app/privacy/page.tsx", "tells people the birthday is optional and kept as a day and month only"),
      reader("src/components/intake/StepsRhythm.tsx", "the joining form's summary shows the birthday"),
      reader("src/components/intake/StepsYou.tsx", "the joining form asks for the birthday"),
      reader("src/lib/intake/answers.ts", "the joining form's rules for the birthday"),
      reader("src/lib/intake/options.ts", "the days in each month the joining form allows"),
      reader("src/lib/intake/server.ts", "loads and saves the joining form with the birthday"),
      reader("src/lib/intake/steps.ts", "the joining form's step for the birthday"),
      reader("src/lib/messaging/templates.ts", "the leader's message the day before a member's birthday"),
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
      reader("src/lib/rhythm/types.ts", "the shape of a birthday in the leader's week"),
      reader("src/lib/rhythm/wording.ts", "the words of a birthday in the leader's week"),
      reader("src/lib/whatsapp/classes.ts", "names the two birthday messages among those that can go by WhatsApp, and which class each belongs to"),
    ],
  },
  {
    key: "about_me",
    label: "About me",
    layer: "story",
    changeClass: "A",
    appliesTo: ["leader", "member"],
    heldIn: "the person's story, kept for them alone",
    dbPattern: "'about_me'",
    appPattern: "about_me|aboutMe",
    db: [
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the line as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
    ],
    app: [
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
    ],
  },
  {
    key: "gifts",
    label: "Gifts",
    layer: "story",
    changeClass: "A",
    appliesTo: ["leader", "member"],
    heldIn: "the person's story, kept for them alone",
    dbPattern: "'gifts'",
    appPattern: "'gifts'|\"gifts\"",
    db: [
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the gifts as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_label", "gives each gift its name"),
      owner("profile_fact_options", "lists the gifts a person may choose from"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
    ],
    app: [
      owner("src/components/profile/MyDetails.tsx", "My page: the person chooses up to three gifts from the list"),
      owner("src/lib/profile/parse.ts", "reads the kind of each field the database sends, including the list of gifts"),
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
    ],
  },
  {
    key: "ask_me",
    label: "Ask me about",
    layer: "story",
    changeClass: "A",
    appliesTo: ["leader", "member"],
    heldIn: "the person's story, kept for them alone",
    dbPattern: "'ask_me'",
    appPattern: "ask_me|askMe",
    db: [
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the line as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
    ],
    app: [
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
    ],
  },
  {
    key: "pray_for_me",
    label: "How to pray for me",
    layer: "story",
    changeClass: "A",
    appliesTo: ["leader", "member"],
    heldIn: "the person's story, kept for them alone",
    dbPattern: "'pray_for_me'",
    appPattern: "pray_for_me|prayForMe",
    db: [
      owner("my_page_state", "shows the fact on My page with its question, its limit and what the person said"),
      owner("profile_fact_applies", "says whether a person is asked about this fact at all"),
      owner("profile_fact_current", "reads the line as held now, with who set it and whether the person confirmed it"),
      owner("profile_fact_feature", "says which switch in God Mode controls asking about this fact"),
      owner("profile_fact_input", "says how this fact is asked: a choice, a short text, a day and month, or a list of gifts"),
      owner("profile_fact_save", "saves what the person typed, in the place the platform already reads it from"),
    ],
    app: [
      owner("src/lib/profile/types.ts", "the shapes of a fact"),
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
