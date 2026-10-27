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

### Database functions (40)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `details_plan_rows` | owner | works out who a Details Check would ask about their stage of life, and who is left out and why |
| `feature_held_back` | owner | keeps anyone in a tribe on a teen track out of the hold-out group (a tribe's track says whether its people are under 18) |
| `messages_welcome_confirm` | owner | adds the 'Confirm your details' line to the leader's welcome email while the stage is unconfirmed |
| `profile_fact_answer` | owner | records the leader's answer about their stage and decides what the change does (free, noted, reviewed) |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the stage as held now, with who set it and whether the person confirmed it |
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

### Database functions (21)

| Function | Role | What it uses the fact for |
| --- | --- | --- |
| `details_plan_rows` | owner | works out who a Details Check would ask about their age range; people under 18 are never asked |
| `profile_fact_answer` | owner | records a member's answer about their age range and decides what the change does |
| `profile_fact_applies` | owner | says whether a person is asked about this fact at all |
| `profile_fact_current` | owner | reads the age range as held now, with who set it and whether the person confirmed it |
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
