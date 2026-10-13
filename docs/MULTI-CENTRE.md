# More than one centre

**Status: groundwork built, switched off, and not safe to switch on yet.** United Tribes runs one centre today (The
Covenant Nation, Iganmu). The blueprint's last release adds others. This file says what is done, what is not, and how to
finish it, so nobody opens a second centre by accident.

## What is done

- Every person has a centre. A role counts only in the centre the person is working in (`has_any_role`, `my_roles`).
- Dashboards, the insight page, community pages, reports, the KPI figures and community champions only ever read a season of the
  person's own centre (`dashboard_season`).
- The newest Stage 6 tools are scoped too: tribe changes, the multiplication planner, and the teens desk (parents and
  guardians), including their link and call functions.
- `my_centres()` lists the centres a person holds a role in. `switch_centre()` moves them. `create_centre()` lets an
  admin open one. The account menu shows a **Centre** choice only when the switch is on **and** the person has a role in
  more than one active centre, so a one-centre church never sees it.
- The switch is `platform_flags.multi_centre` (off). Only the database owner can turn it on:

  ```sql
  update public.platform_flags set enabled = true where key = 'multi_centre';
  ```

## What is not done: office views that still show every centre

These screens read people or tribes with no centre filter. With one centre that is correct. With two, a director in
centre B would see centre A's rows in them. **Make each of these centre-scoped (and add a test for each, like the
Stage 6 ones in `tests/db/swaps.test.ts` and `tests/db/teens.test.ts`) before turning the switch on.**

| Screen | Functions |
| --- | --- |
| Review leaders: applications, interviews | `review_queue`, `review_interviews`, `leader_stats` |
| Care tasks and the weekly care numbers | `care_queue`, `care_task_stats`, `my_care_tasks` (lists tasks by assignee, so is safe per person) |
| Weekly report | `rhythm_digest` (chooses "the current season" of any centre) |
| Testimonies waiting for review | `pending_testimonies`, `testimony_wall` |
| Leader Academy lists | `academy_cohort`, `academy_stats`, `academy_sessions_admin`, `tribe_queue`, `suggest_assistants`, `assign_coach`, `pair_assistant` |
| Matching numbers | `match_stats`, `intake_stats` |
| Messages | `message_log`, `message_stats` |

Also not centre-aware:

- **`care_team()`** (who is told about a care alert, a swap with no coach, or a parent's answer) returns the care lead
  (else the director, else the admin) of *any* centre. With two centres, it must return the one for the tribe's centre.
- **The outbox**: `enqueue_message` for someone outside the system (a referee, a parent) is not tied to a centre.
- **The BI copy** (`bi_refresh`, the `bi` schema) is one copy for the whole programme, with no centre column.
- **KPI targets** are one set for everyone. A centre cannot have its own targets.
- **Sign-up**: a new person is placed in the first centre. There is no "choose your centre" for members yet.
- **Reports and the monthly job** make one report per month for the programme, not one per centre.

## How to finish it (in the order that does least harm)

1. Add `centre_id` to the few tables that lack a way to reach one (applications, messages), or join through the person.
2. Scope each function in the table above with `public.my_centre()` the way `swap_staff` and `guardian_overview` do.
3. Make `care_team(p_centre)` take a centre, and pass the tribe's.
4. Give a centre its own targets, its own report run and its own BI rows (or a centre column to filter by).
5. Add a "choose your centre" step to sign-up, or invite members by centre link.
6. Write a database test for each scoped function with two centres, as the Stage 6 tests do (`another centre: is out of
   reach`).
7. Only then turn the switch on, for one test centre first.
