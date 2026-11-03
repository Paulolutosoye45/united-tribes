# Who reads what a person has told us

*Written by `npm run readers` from `src/lib/profile/registry.ts`. Do not edit it here; change the list in the source and run the command again.*

One fact, one owner, many readers. The owner of a fact is the person it is about: the office only proposes, and the person confirms. The readers are the places
listed below. A test (`tests/db/profile-readers.test.ts`) scans every database function and every file under `src/` for each fact and fails when a place reads a fact
and is not listed here, or is listed and no longer reads it, so a new reader cannot be added without being written down, with what it uses the fact for.

## Stage of life (`life_stage`)

- Applies to: leader
- Change class: C, reviewed: for a person in a tribe or leading one it waits for the pastor of their centre, and the old value stays in force until then
- Held today in: the leader's tribe (its track), the answer on the leader's application, the office's short form at the appointment; and, once confirmed, the facts store
- Found by scanning for: `track_id|calling,track|form ->> 'track'|life_stage` in database functions and `life_stage|lifeStage|calling\.track|trackId|track_id` in source files

### Database functions (43)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `details_plan_rows` | owner | works out who a Details Check would ask about their stage of life, and who is left out and why |
| `feature_held_back` | owner | keeps anyone in a tribe on a teen track out of the hold-out group (a tribe's track says whether its people are under 18) |
| `messages_welcome_confirm` | owner | adds the 'Confirm your details' line to the leader's welcome email while the stage is unconfirmed |
| `profile_fact_answer` | owner | records the leader's answer about their stage and decides what the change does (free, noted, reviewed) |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the stage as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_label` | owner | gives a stage its words |
| `profile_fact_options` | owner | lists the stages a leader may choose from |
| `profile_stage_confirmed` | owner | says whether the leader has confirmed their stage (the hold on a Tribe Card reads this) |
| `stage_review_decide` | owner | applies or declines a reviewed change to a leader's stage |
| `tribe_stage_status` | owner | shows the pastor the leader's stage beside the card's |
| `admin_catalogue` | reader | lists the tracks the admin can open or close |
| `assistant_tribe_young` | reader | tells whether a tribe is the teen track, which changes who may assist |
| `church_views` | reader | groups the pastors' counts of tribes and members by track |
| `dashboard_core` | reader | groups the dashboard's tribes by track |
| `export_leaders_roster` | reader | puts each leader's track in the leaders' roster file |
| `god_appoint_leader` | reader | starts the appointed leader's tribe on the track the office suggested |
| `god_appointment_inputs` | reader | reads and checks the office's suggested track on the appointment form |
| `god_person` | reader | shows the owner a person's tribe and track |
| `god_start_leader_card` | reader | starts a tribe for an approved leader on the track in their application |
| `intake_stats` | reader | counts joiners by track |
| `leader_ai_list` | reader | shows the track from each application in the panel's list |
| `leader_fit_inputs` | reader | gives the leader fit model the track from the application |
| `leader_offer_respond` | reader | starts the tribe on the application's track when a leader accepts |
| `match_candidates` | reader | lists the tribes a member may be placed in, by the member's track |
| `match_card` | reader | shows a tribe's track on its match card |
| `match_me` | reader | chooses the member's tribes from the track their age range belongs to |
| `match_stats` | reader | counts tribes and places by track |
| `multiplication_board` | reader | groups tribes by track for the multiplication board |
| `my_tribe` | reader | tells the leader their card is missing a track |
| `placement_candidates` | reader | the placement run's list of tribes for a member, by track |
| `placement_one_check` | reader | warns the owner when the tribe's track is not the track of the person's age range, before one person is placed |
| `placement_run_approve` | reader | checks teen-track rules when a placement run is approved |
| `review_queue` | reader | shows the track from each application in the panel's queue |
| `save_tribe_card` | reader | saves the track a leader chooses on their Tribe Card |
| `start_tribe_card` | reader | starts a leader's draft card on the track in their application |
| `submit_tribe_card` | reader | refuses to submit a card with no track |
| `suggest_assistants` | reader | ranks possible assistants higher when their track matches the tribe's |
| `tribe_json` | reader | puts the tribe's track in the tribe's card as everyone reads it |
| `tribe_queue` | reader | shows each card's track in the pastor's queue |
| `worker_pending_leader_jobs` | reader | gives the sending service each leader's track for their messages |

### Source files (7)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/app/(app)/my/actions.ts` | owner | My page: the leader answers about their stage |
| `src/app/(public)/details/[token]/actions.ts` | owner | the private page: the leader answers about their stage |
| `src/components/god/DetailsConsole.tsx` | owner | the owner's Details Check console: which fact to ask about |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |
| `src/lib/profile/wording.ts` | owner | the words of each stage and each way a change ends |
| `src/components/leaders/ApplySteps.tsx` | reader | the leader's application asks for a track |
| `src/lib/ai/sensitive.ts` | reader | words the assistant treats as sensitive |

## Age range (`age_range`)

- Applies to: member
- Change class: C, reviewed: for a person in a tribe or leading one it waits for the pastor of their centre, and the old value stays in force until then
- Held today in: the member's profile (their answer on the joining form); and, once confirmed, the facts store
- Found by scanning for: `age_range_id|age_ranges|age_range` in database functions and `age_range_id|ageRange|age_range|age_ranges` in source files

### Database functions (26)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `details_plan_rows` | owner | works out who a Details Check would ask about their age range; people under 18 are never asked |
| `my_office_ask` | owner | takes a person's request to the office to change an age range across the line between 17 and 18 (never self-service) |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_answer` | owner | records a member's answer about their age range and decides what the change does |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the age range as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_label` | owner | gives an age range its words |
| `profile_fact_options` | owner | lists the age ranges a member may choose from |
| `stage_review_decide` | owner | applies or declines a reviewed change (a member's age range never needs one today) |
| `activity_build_people` | reader | groups people by age range in the activity report |
| `admin_catalogue` | reader | lists each track's age ranges for the admin |
| `church_views` | reader | counts members by age range for the pastors' views |
| `export_my_data` | reader | gives a person their own age range in their data file |
| `god_person` | reader | shows the owner a person's age range |
| `intake_stats` | reader | counts joiners by age range |
| `is_minor` | reader | decides whether a member is under 18, which is the rule for young people everywhere |
| `match_candidates` | reader | finds the member's track from their age range to choose tribes |
| `match_me` | reader | finds the member's track from their age range to choose tribes |
| `message_blocker` | reader | stops messages to members under 18 |
| `notice_is_young` | reader | stops notices to members under 18 |
| `placement_candidates` | reader | the placement run's list of tribes for a member, by the track of their age range |
| `placement_one_check` | reader | compares the person's age range track with the tribe's before one person is placed |
| `placement_run_approve` | reader | checks the young people's rules when a placement run is approved |
| `profile_teen_guard` | reader | refuses a profile change that would cross the line between under and over 18 |

### Source files (16)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/app/(app)/my/actions.ts` | owner | My page: the member answers about their age range |
| `src/app/(public)/details/[token]/actions.ts` | owner | the private page: the member answers about their age range |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |
| `src/lib/profile/wording.ts` | owner | the words of each age range and each way a change ends |
| `src/app/(focus)/join/actions.ts` | reader | the joining form saves the member's age range |
| `src/components/intake/IntakeFlow.tsx` | reader | the joining form: the step that asks |
| `src/components/intake/JoinedView.tsx` | reader | the page after joining shows the answer |
| `src/components/intake/StepsRhythm.tsx` | reader | the joining form's steps |
| `src/components/intake/StepsYou.tsx` | reader | the joining form asks for the age range |
| `src/components/intake/types.ts` | reader | the joining form's shapes |
| `src/components/intake/useCompanion.ts` | reader | the companion beside the form reads the age range |
| `src/lib/companion/profile.ts` | reader | the companion's picture of the member |
| `src/lib/companion/sentences.ts` | reader | the companion's sentences use the age range |
| `src/lib/intake/answers.ts` | reader | the joining form's answers |
| `src/lib/intake/server.ts` | reader | saves the joining form |
| `src/lib/intake/steps.ts` | reader | the joining form's steps and options |

## Name we use for you (`preferred_name`)

- Applies to: leader and member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the person's own record (the name they asked to be called)
- Found by scanning for: `preferred_name` in database functions and `preferredName|preferred_name` in source files

### Database functions (26)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the name as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |
| `activity_audit` | reader | shows the name in the activity audit when a person has no full name |
| `activity_funnel_people` | reader | shows the name in the funnel's list of people when a person has no full name |
| `activity_stakeholders` | reader | shows the name of the person behind a count when there is no full name |
| `export_my_data` | reader | puts the name in the data file a person downloads about themselves |
| `find_people` | reader | finds a person by the name they asked to be called, and shows it |
| `first_name_of` | reader | gives the name used first in every message, notice and greeting |
| `god_appoint_leader` | reader | greets the leader being appointed by the name they asked to be called |
| `god_appointment_find` | reader | finds a person to appoint by the name they use |
| `god_feature_find` | owner | finds a person for the switchboard by the name they use |
| `god_feed` | reader | names who did something in the owner's feed when there is no full name |
| `god_people` | reader | finds and lists people for the owner by the name they use |
| `god_person` | reader | shows the owner the name a person asked to be called |
| `god_start_leader_card` | reader | greets the leader whose tribe is being started by the name they use |
| `handle_new_user` | reader | saves the name from the sign-in provider on the person's record when they first arrive |
| `leader_goal_guard` | reader | names the leader in the message about their season goal |
| `leader_offer_respond` | reader | greets the leader accepting an offer by the name they use |
| `person_display_name` | reader | gives every list and page the one display name for a person |
| `signin_admin_overview` | reader | names who signed in, in the admin overview |
| `start_tribe_card` | reader | puts the leader's first name on the new tribe card |
| `swap_members` | reader | finds a member to swap by the name they use |

### Source files (25)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/app/(app)/actions.ts` | reader | saves the name a person types on their profile |
| `src/app/(app)/admin/people/page.tsx` | reader | shows the admin each person's name |
| `src/app/(app)/god/conversations/page.tsx` | reader | names the person in the owner's conversations |
| `src/app/(app)/god/people/[id]/page.tsx` | reader | names the person on the owner's page about them |
| `src/app/(app)/home/page.tsx` | reader | greets the person on Home |
| `src/app/(app)/lead/page.tsx` | reader | names the applicant when they ask their referees |
| `src/app/(app)/lead/hand/page.tsx` | reader | signs the words a leader sends by WhatsApp from their own phone with their first name |
| `src/app/(app)/lead/week/page.tsx` | reader | signs the leader's week with their name |
| `src/app/(app)/profile/page.tsx` | reader | names the person beside their photo |
| `src/app/(app)/review/rhythm/page.tsx` | reader | signs the Care Team's review with the reviewer's name |
| `src/app/(app)/tribe/page.tsx` | reader | names the young person on the page that tells them to wait |
| `src/app/(focus)/join/actions.ts` | reader | the joining form saves the name |
| `src/app/(focus)/join/page.tsx` | reader | the joining form starts from the name already held |
| `src/app/(focus)/lead/apply/page.tsx` | reader | greets the person starting a leader application |
| `src/components/intake/IntakeFlow.tsx` | reader | the joining form passes the name to its steps |
| `src/components/intake/JoinedView.tsx` | reader | the page after joining greets the person by name |
| `src/components/intake/StepsRhythm.tsx` | reader | the joining form's summary shows the name |
| `src/components/intake/StepsYou.tsx` | reader | the joining form asks for the name |
| `src/components/shell/AppShell.tsx` | reader | the account menu shows the name |
| `src/lib/auth/session.ts` | reader | puts the name on the signed-in person every page reads |
| `src/lib/god/types.ts` | reader | the shape of a person on the owner's pages |
| `src/lib/intake/answers.ts` | reader | the joining form's rules for the name |
| `src/lib/intake/server.ts` | reader | loads and saves the joining form with the name |
| `src/lib/intake/steps.ts` | reader | the joining form's step for the name |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |

## Area (`area`)

- Applies to: member
- Change class: B, noted: saved at once, the next list of suggested tribes is worked out again, nobody is moved
- Held today in: the member's profile (their answer on the joining form: one of five areas, and a short note)
- Found by scanning for: `(^|[^a-z_])(mp|me|prof|ap|r)\.zone([^a-z_]|$)|area_note|when 'area' then|p_key = 'area'` in database functions and `answers\.zone|areaNote|areaSlug|area_note|form\.zone|options\.zone|input\.zone|profile\.zone|area\.zone|live\.zone|row\.zone|context\.zone|\ba\.zone` in source files

### Database functions (17)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the area as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_label` | owner | gives an area its words |
| `profile_fact_options` | owner | lists the five areas a member may choose from |
| `profile_fact_save` | owner | saves what the person chose, in the place the platform already reads it from |
| `activity_build_people` | reader | copies each member's area into the activity report's people table |
| `activity_compare` | reader | compares groups by area in the activity report |
| `activity_funnels` | reader | counts the joining funnel by area |
| `activity_member_rows` | reader | lists each member's area for the activity report |
| `god_person` | reader | shows the owner a member's area |
| `match_candidates` | reader | keeps in-person tribes close to the member and scores a nearer area higher |
| `match_me` | reader | saves the member's area with the list of tribes suggested for them |
| `placement_candidates` | reader | the placement run's list of tribes for a member, close to where they are |
| `placement_run_approve` | reader | carries the member's area into the placement when a run is approved |
| `placement_run_new` | reader | lets the office start a placement run for one area |

### Source files (15)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/app/(app)/god/people/[id]/page.tsx` | reader | shows the owner a member's area beside how they like to meet |
| `src/app/(app)/god/placement/actions.ts` | reader | lets the office start a placement run for one area |
| `src/app/(focus)/join/actions.ts` | reader | the joining form saves the area and the note |
| `src/components/intake/AreaInput.tsx` | reader | the joining form's area picker |
| `src/components/intake/IntakeFlow.tsx` | reader | the joining form suggests meeting times from the area |
| `src/components/intake/StepsHeard.tsx` | reader | the joining form fills the area when a place is picked |
| `src/components/intake/StepsRhythm.tsx` | reader | the joining form's summary shows where the person is based |
| `src/components/intake/StepsYou.tsx` | reader | the joining form asks where the person is based |
| `src/components/intake/useCompanion.ts` | reader | the companion beside the form reads the area |
| `src/lib/companion/plan.ts` | reader | the companion's plan uses the area |
| `src/lib/companion/profile.ts` | reader | the companion's picture of the member includes the area |
| `src/lib/companion/rank.ts` | reader | the companion ranks tribes by how close they are to the area |
| `src/lib/intake/answers.ts` | reader | the joining form's rules for the area |
| `src/lib/intake/server.ts` | reader | loads and saves the joining form with the area |
| `src/lib/intake/steps.ts` | reader | the joining form's step for the area |

## Birthday (`birthday`)

- Applies to: member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the member's profile (the day and month, from the joining form)
- Found by scanning for: `birthday` in database functions and `birthday` in source files

### Database functions (8)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the day and month as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_label` | owner | writes a birthday in words, day then month |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |
| `run_calendar` | reader | tells the leader the day before a member's birthday |
| `tribe_week` | reader | puts a member's birthday in the leader's week |

### Source files (13)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/app/(focus)/join/actions.ts` | reader | the joining form saves the day and month |
| `src/app/privacy/page.tsx` | reader | tells people the birthday is optional and kept as a day and month only |
| `src/components/intake/StepsRhythm.tsx` | reader | the joining form's summary shows the birthday |
| `src/components/intake/StepsYou.tsx` | reader | the joining form asks for the birthday |
| `src/lib/intake/answers.ts` | reader | the joining form's rules for the birthday |
| `src/lib/intake/options.ts` | reader | the days in each month the joining form allows |
| `src/lib/intake/server.ts` | reader | loads and saves the joining form with the birthday |
| `src/lib/intake/steps.ts` | reader | the joining form's step for the birthday |
| `src/lib/messaging/templates.ts` | reader | the leader's message the day before a member's birthday |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |
| `src/lib/rhythm/types.ts` | reader | the shape of a birthday in the leader's week |
| `src/lib/rhythm/wording.ts` | reader | the words of a birthday in the leader's week |
| `src/lib/whatsapp/classes.ts` | reader | names the two birthday messages among those that can go by WhatsApp, and which class each belongs to |

## About me (`about_me`)

- Applies to: leader and member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the person's story, kept for them alone
- Found by scanning for: `'about_me'` in database functions and `about_me|aboutMe` in source files

### Database functions (6)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the line as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |

### Source files (1)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |

## Gifts (`gifts`)

- Applies to: leader and member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the person's story, kept for them alone
- Found by scanning for: `'gifts'` in database functions and `'gifts'|"gifts"` in source files

### Database functions (8)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the gifts as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_label` | owner | gives each gift its name |
| `profile_fact_options` | owner | lists the gifts a person may choose from |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |

### Source files (3)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/components/profile/MyDetails.tsx` | owner | My page: the person chooses up to three gifts from the list |
| `src/lib/profile/parse.ts` | owner | reads the kind of each field the database sends, including the list of gifts |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |

## Ask me about (`ask_me`)

- Applies to: leader and member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the person's story, kept for them alone
- Found by scanning for: `'ask_me'` in database functions and `ask_me|askMe` in source files

### Database functions (6)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the line as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |

### Source files (1)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |

## How to pray for me (`pray_for_me`)

- Applies to: leader and member
- Change class: A, free: saved at once, nothing else moves
- Held today in: the person's story, kept for them alone
- Found by scanning for: `'pray_for_me'` in database functions and `pray_for_me|prayForMe` in source files

### Database functions (6)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `my_page_state` | owner | shows the fact on My page with its question, its limit and what the person said |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the line as held now, with who set it and whether the person confirmed it |
| `profile_fact_feature` | owner | says which switch in God Mode controls asking about this fact |
| `profile_fact_input` | owner | says how this fact is asked: a choice, a short text, a day and month, or a list of gifts |
| `profile_fact_save` | owner | saves what the person typed, in the place the platform already reads it from |

### Source files (1)

| File | Role | What it uses the fact for |
| --- | --- | --- |
| `src/lib/profile/types.ts` | owner | the shapes of a fact |
