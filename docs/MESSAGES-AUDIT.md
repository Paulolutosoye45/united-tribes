# Every message the platform can send

*Written by `npm run messages-audit` from the templates in `src/lib/messaging`. Do not edit it here; change the template and run the command again. A test fails when a check below fails or when this file is out of date.*

**152 messages**, 16 for applicant, 11 for care, 14 for coach, 1 for guardian, 1 for invitee, 39 for leader, 22 for member, 43 for office, 5 for referee.

Each message is written out from believable details and checked for what the office would check by eye:

1. nothing left unfilled (no `{{ }}`, `undefined`, `null` or `NaN`) in the subject, the email, the text message or the WhatsApp wording;
2. a subject that fits one line, and a text message that fits two;
3. WhatsApp wording Meta can approve: variables numbered in order, one example for each, under 1,024 characters;
4. every link in the email an https address, and a count of how many go to another site (a meeting room, a chat group);
5. which part of the platform queues it, and the other way round: every message the database queues by name must exist.

**Result: every check passes.** Messages the database queues that have no template: none.

## For applicant

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `applicant_referee_slow` | A referee has not answered yet | A referee has not answered yet | 48 | 70 | email only | 2 / 0 | — |
| `applicant_reference_in` | A reference has come in | A reference has come in | 43 | 63 | email only | 2 / 0 | — |
| `applicant_still_with_us` | Your application is still with us | Your application is still with us | 56 | 73 | email only | 2 / 0 | — |
| `application_approved` | You’ve been approved | Welcome: you’re approved as tribe leader | 76 | 93 | `ut_application_approved` | 2 / 0 | — |
| `application_approved_declaration` | You’ve been approved (declaration only) | Welcome: you’re approved as tribe leader | 72 | 128 | `ut_application_approved_declaration` | 2 / 0 | — |
| `application_approved_open` | You’ve been approved (nothing to complete first) | Welcome: you’re approved as tribe leader | 83 | 87 | `ut_application_approved_open` | 2 / 0 | — |
| `application_approved_optional` | You’ve been approved (Academy optional) | Welcome: you’re approved as tribe leader | 88 | 116 | `ut_application_approved_optional` | 2 / 0 | — |
| `application_interview_booked` | Your conversation is booked | Your conversation is booked | 45 | 84 | `ut_application_interview_booked` | 2 / 1 | — |
| `application_interview_invited` | You’re invited to a conversation | You’re invited to a short conversation | 47 | 106 | `ut_application_interview_invited` | 2 / 0 | — |
| `application_not_approved` | A decision on your application | About your leader application | 92 | 113 | `ut_application_not_approved` | 2 / 0 | — |
| `application_received` | Your application was received | We’ve received your leader application | 63 | 107 | `ut_application_received` | 2 / 0 | — |
| `leader_check_clear` | Your referees’ links are ready | Your referees’ links are ready | 63 | 116 | `ut_leader_check_clear` | 2 / 0 | database |
| `leader_check_clear_open` | Your application has been read | Your application has been read | 56 | 106 | `ut_leader_check_clear_open` | 2 / 0 | — |
| `leader_check_clear_optional` | Your application has been read (referees optional) | Your application has been read | 63 | 125 | `ut_leader_check_clear_optional` | 2 / 0 | — |
| `leader_check_consent` | One sentence on your application has changed | Please read one new sentence on your application | 67 | 130 | `ut_leader_check_consent` | 2 / 0 | database |
| `leader_check_strengthen` | A little more would help your application | A little more would help your application | 83 | 141 | `ut_leader_check_strengthen` | 2 / 0 | database |

## For care

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `care_age_ask` | Someone says their age range is not right | Someone says their age range is not right | 66 | 81 | email only | 2 / 0 | — |
| `care_asks_waiting` | People have asked for someone to reach out | 0 people asked for someone to reach out | 46 | 78 | email only | 2 / 0 | — |
| `care_callbacks_due` | Referee call-backs are due | 0 referee call-backs due this week | 42 | 77 | email only | 2 / 0 | — |
| `care_removal_appeal` | A member has asked for a decision to be looked at again | A member has asked for a decision to be looked at again | 75 | 100 | email only | 2 / 0 | — |
| `care_removal_ask` | A leader has asked about a member's place | A leader has asked about a member’s place | 82 | 86 | email only | 2 / 0 | — |
| `care_removal_waiting` | A request about a member's place is still waiting | A request about a member’s place has waited three days | 60 | 99 | email only | 2 / 0 | — |
| `care_task_overdue` | A care task is late | Late: pastoral care for Ada Okafor | 68 | 78 | `ut_care_task_overdue` | 2 / 0 | database |
| `care_teen_confirm` | A parent's permission is waiting for its call | A permission is waiting for its confirmation call | 51 | 89 | email only | 2 / 0 | — |
| `care_urgent` | Urgent care: same-day response | URGENT care: Ada Okafor (Builders Tribe) | 63 | 114 | `ut_care_urgent` | 2 / 0 | database |
| `guardian_update` | A parent or guardian has answered | Ada’s parent or guardian said yes | 54 | 104 | `ut_guardian_update` | 2 / 0 | database |
| `journey_ask` | Someone answered a reminder and asked for a person | Ada Okafor asked for a person to reach out | 55 | 102 | email only | 2 / 0 | app, database |

## For coach

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `coach_card_submitted` | A leader sent in a Tribe Card | Ngozi Okafor sent in a Tribe Card | 52 | 75 | email only | 2 / 0 | — |
| `coach_details_unanswered` | A leader has not answered the check of their details | Please speak to Ngozi Okafor about their details | 60 | 83 | email only | 2 / 0 | — |
| `coach_digest` | Monday: your tribes’ digest | Your tribes, week 3 | 62 | 81 | `ut_coach_digest` | 2 / 0 | app, database |
| `coach_help` | A leader asked for their coach | Ngozi Okafor would like your help | 54 | 114 | `ut_coach_help` | 2 / 0 | app, database |
| `coach_leader_stalled` | A leader has stopped moving in the Academy | Ngozi has not moved in the Academy | 46 | 78 | email only | 2 / 0 | — |
| `coach_log_missing` | A leader has not logged (48 hours) | Builders Tribe hasn’t logged week 3 | 51 | 127 | `ut_coach_log_missing` | 2 / 0 | database |
| `coach_low_pulse` | A low sense of belonging | Ada Okafor may not be feeling at home | 63 | 127 | `ut_coach_low_pulse` | 2 / 0 | database |
| `coach_missed_three` | A member has missed three meetings | Ada Okafor has missed 3 meetings | 64 | 121 | `ut_coach_missed_three` | 2 / 0 | database |
| `coach_new_leader` | A leader was given to you | Ngozi Okafor is now one of your leaders | 45 | 81 | email only | 2 / 0 | — |
| `coach_practice_ready` | A leader is ready for a practice assessment | Ngozi Okafor is ready for a practice assessment | 42 | 91 | email only | 2 / 0 | — |
| `coach_removal_ask` | A leader has asked about a member's place | A leader has asked about a member’s place | 84 | 86 | email only | 2 / 0 | — |
| `coach_removal_waiting` | A request about a member's place is waiting for you | A request about a member’s place has waited three days | 76 | 99 | email only | 2 / 0 | — |
| `coach_welcome_overdue` | A new member still has not been called (7 days) | Ada still hasn’t been called | 48 | 140 | `ut_coach_welcome_overdue` | 2 / 0 | database |
| `swap_requested` | A member has asked to change tribe | Ada would like to change tribe | 83 | 121 | `ut_swap_requested` | 2 / 0 | database |

## For guardian

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `guardian_request` | A parent or guardian is asked for permission | Ada would like to join a small group at The Covenant Nation | 117 | 205 | `ut_guardian_request` | 2 / 0 | database |

## For invitee

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `role_invitation` | Someone is invited to serve, or has been given a role | You are invited to serve on United Tribes as a tribe leader | 112 | 139 | email only | 1 / 0 | database |

## For leader

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `assistant_decided` | The answer to your assistant leader recommendation | Your assistant leader is confirmed | 39 | 127 | email only | 2 / 0 | database |
| `assistant_invited` | You have been recommended as an assistant leader | You have been recommended as an assistant leader | 80 | 117 | email only | 2 / 0 | database |
| `assistant_paired` | You are now an assistant leader | You are now assistant leader of Builders Tribe | 58 | 102 | email only | 2 / 0 | database |
| `assistant_replaced` | Your role as an assistant leader has changed | Your role in Builders Tribe has changed | 63 | 112 | email only | 2 / 0 | database |
| `birthday_today` | A birthday today: prompt the group | Today is Ada’s birthday | 68 | 61 | `ut_birthday_today` | 1 / 1 | database |
| `birthday_tomorrow` | A birthday tomorrow | Ada’s birthday is tomorrow | 38 | 63 | `ut_birthday_tomorrow` | 2 / 0 | database |
| `care_task` | A care task for you (7 days) | A pastoral care task: Ada Okafor | 72 | 100 | `ut_care_task` | 2 / 0 | database |
| `care_task_reminder` | A care task is due in two days | Due in two days: pastoral care for Ada Okafor | 72 | 107 | `ut_care_task_reminder` | 2 / 0 | database |
| `celebration_prompt` | Something to celebrate in your tribe | Celebrate with Ada | 51 | 108 | `ut_celebration_prompt` | 2 / 1 | database |
| `champion_month` | Your community this month | Your community this month | 33 | 64 | email only | 2 / 0 | — |
| `champion_waiting` | Members are waiting in your community | 0 people waiting in your community | 51 | 73 | email only | 2 / 0 | — |
| `details_check_code` | A six-digit code to open a private link | 482913 is your United Tribes code | 60 | 65 | email only | 1 / 0 | database |
| `details_check_reminder` | A reminder to check the details held for a tribe | A reminder: please check the details for your tribe | 82 | 197 | `ut_details_check_request` (reused) | 2 / 0 | database |
| `details_check_request` | A request to check the details held for a tribe | Please check the details we hold for your tribe | 92 | 190 | `ut_details_check_request` +1 button | 2 / 0 | database |
| `leader_academy_next` | Your next Academy step | Your next Academy step: keep going | 41 | 76 | email only | 2 / 0 | — |
| `leader_assistant_added` | An assistant was added to your tribe | Someone is now your assistant | 49 | 69 | email only | 2 / 0 | — |
| `leader_card_approved` | Your Tribe Card was approved | Builders Tribe was approved | 44 | 67 | email only | 2 / 0 | — |
| `leader_card_changes` | Your Tribe Card needs a few changes | Builders Tribe needs a few changes | 62 | 74 | email only | 2 / 0 | — |
| `leader_certified` | You are certified | You are certified | 38 | 51 | email only | 2 / 0 | app |
| `leader_log_link` | After the meeting: the two-minute log | Log tonight’s meeting (two minutes) | 44 | 90 | `ut_leader_log_link` | 2 / 0 | database |
| `leader_log_reminder` | The meeting has not been logged (24 hours) | Your week 3 log is waiting | 51 | 104 | `ut_leader_log_reminder` | 2 / 0 | database |
| `leader_meeting_reminder` | Two hours before: your reminder with the guide | In two hours: Builders Tribe | 51 | 119 | `ut_leader_meeting_reminder` | 2 / 0 | database |
| `leader_missed_one` | A member missed a meeting: a warm message to forward | Ada wasn’t at Builders Tribe | 77 | 187 | `ut_leader_missed_one` | 2 / 0 | database |
| `leader_missed_two` | Two meetings missed in a row: call them | Please call Ada | 76 | 92 | `ut_leader_missed_two` | 2 / 0 | database |
| `leader_next_season` | Next season: continue, multiply or rest? | Next season: continue, multiply or rest? | 47 | 74 | email only | 2 / 0 | — |
| `leader_offer` | An offer to lead a tribe where members are waiting | Would you lead a tribe this season? | 91 | 114 | email only | 2 / 0 | database |
| `leader_prep` | Monday: your prep pack | Prep for week 3: Pray with expectation, not performance | 75 | 111 | `ut_leader_prep` | 2 / 0 | database |
| `leader_seats` | Seats are nearly gone | Builders Tribe has 2 seats left | 40 | 71 | email only | 2 / 0 | — |
| `leader_tribe_open` | Your tribe is open to members | Builders Tribe is open to members | 44 | 73 | email only | 2 / 0 | — |
| `leader_welcome` | Welcome to leading a tribe | Welcome to leading a tribe | 591 | 115 | email only | 2 / 0 | app, database |
| `leader_workshop_tomorrow` | A workshop is tomorrow | Tomorrow: your workshop | 39 | 65 | email only | 2 / 0 | — |
| `new_member` | Someone joined your tribe: call within 72 hours | Ada joined Builders Tribe | 66 | 98 | `ut_new_member` | 2 / 0 | database |
| `placement_leader_appointed` | You have been appointed to lead a tribe | You have been appointed to lead a tribe | 113 | 123 | email only | 2 / 0 | database |
| `placement_your_team` | Who is on your team | Your team: Builders Tribe | 127 | 118 | email only | 2 / 0 | database |
| `removal_leader_decided` | A leader is told what was decided about their request | Your request about Bola was approved | 120 | 92 | email only | 2 / 0 | database |
| `swap_moved` | A member has moved tribe | Ada is joining your tribe | 60 | 115 | `ut_swap_moved` | 2 / 0 | database |
| `testimony_waiting` | A testimony is waiting for you | A testimony is waiting for your approval | 40 | 107 | `ut_testimony_waiting` | 2 / 0 | database |
| `weekly_report` | Saturday: the weekly tribe report | Week 3 report: Builders Tribe | 55 | 111 | `ut_weekly_report` | 2 / 0 | database |
| `welcome_call_overdue` | A new member has not been called yet | Have you reached Ada yet? | 51 | 107 | `ut_welcome_call_overdue` | 2 / 0 | database |

## For member

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `friday_checkin` | Friday: one-tap step check-in and testimony prompt | How did your step go? | 71 | 166 | `ut_friday_checkin` +3 buttons | 5 / 0 | database |
| `meeting_recap` | The morning after: recap and your step | Last night in Builders Tribe | 60 | 92 | `ut_meeting_recap` | 2 / 0 | database |
| `meeting_reminder` | Two hours before the meeting | Tonight at 8:00 pm: Builders Tribe | 42 | 72 | `ut_meeting_reminder` | 1 / 1 | database |
| `member_deletion_done` | Your information has been deleted | Your information has been deleted | 46 | 33 | email only | 1 / 0 | — |
| `member_deletion_received` | We received your deletion request | We received your deletion request | 50 | 70 | email only | 1 / 0 | — |
| `member_meeting_changed` | Your tribe's meeting has changed | Builders Tribe: the meeting has changed | 37 | 74 | email only | 2 / 1 | — |
| `member_missed_two` | We missed you | We missed you | 64 | 95 | `ut_member_missed_two` | 2 / 0 | database |
| `member_testimony_shared` | Your testimony was shared | Your testimony was shared | 46 | 70 | email only | 2 / 0 | — |
| `office_message` | An announcement from the church office | Your tribe is waiting, Ada | 45 | 60 | email only | 3 / 0 | app, database |
| `placement_reminder` | A gentle reminder about the tribe you were placed in | Builders Tribe is holding your place | 80 | 108 | email only | 4 / 0 | database |
| `placement_withheld` | Your details are kept private; here is how to reach your tribe | Your details are private. Here is how to join | 110 | 113 | email only | 2 / 1 | database |
| `placement_your_tribe` | The church has placed you in a tribe | A place for you in Builders Tribe | 188 | 131 | email only | 4 / 1 | database |
| `reminder_email` | A reminder from one of the four journeys | You’re part-way to your tribe, Ada | 91 | 88 | email only | 3 / 0 | app, database |
| `removal_member_reinstated` | A member is told their place in a tribe has been put back | Your place in Builders Tribe is back | 66 | 97 | email only | 2 / 0 | database |
| `removal_member_told` | A member is told their place in a tribe has changed | Your place in Builders Tribe has changed | 144 | 125 | email only | 2 / 0 | database |
| `season_complete` | The season is complete | Season 1 is complete | 63 | 108 | `ut_season_complete` | 2 / 0 | database |
| `season_starts_soon` | The season starts in two days | Your season starts on Sun 14 Feb | 68 | 108 | `ut_season_starts_soon` | 2 / 1 | database |
| `swap_declined` | About your request to change tribe | About your request to change tribe | 69 | 120 | `ut_swap_declined` | 2 / 0 | database |
| `swap_offered` | A tribe that could suit you | A tribe that could suit you | 66 | 129 | `ut_swap_offered` | 2 / 0 | database |
| `triad_prompt` | Tuesday: check in with your triad | Check in with your triad | 64 | 125 | `ut_triad_prompt` | 2 / 0 | database |
| `week_start` | Monday: the week’s passage, confession and step | Week 3: Pray with expectation, not performance | 80 | 159 | `ut_week_start` | 2 / 0 | app, database |
| `welcome` | Welcome to your tribe | You’re in: welcome to Builders Tribe | 71 | 139 | `ut_welcome` | 2 / 1 | app, database |

## For office

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin_application_sent` | A new leader application was sent | A new leader application was sent | 48 | 69 | email only | 2 / 0 | — |
| `admin_checklist_overdue` | Launch steps are still open before a season | Season 1: 0 launch steps open, 0 days to go | 39 | 86 | email only | 2 / 0 | — |
| `admin_data_request` | A deletion request came in | A deletion request came in | 54 | 69 | email only | 2 / 0 | — |
| `admin_data_request_due` | A deletion request is nearly due | A deletion request is due in 0 days | 52 | 78 | email only | 2 / 0 | — |
| `admin_email_health` | How the week's email went | This week’s email: 0 sent, 0 failed | 54 | 79 | email only | 2 / 0 | — |
| `admin_messages_failing` | Messages are failing | 0 messages failed in the last hour | 58 | 78 | email only | 2 / 0 | — |
| `admin_queue_stuck` | Messages are not going out | Messages are not going out | 49 | 68 | email only | 2 / 0 | — |
| `admin_reporting_failed` | The reporting copy did not refresh | The reporting copy did not refresh | 50 | 76 | email only | 2 / 0 | — |
| `admin_role_changed` | Someone's role changed | Someone: tribe leader role added | 45 | 74 | email only | 2 / 0 | — |
| `broadcast_waiting` | An announcement is waiting for your approval | An announcement needs your approval | 63 | 104 | email only | 2 / 0 | app, database |
| `data_integrity_week` | The week's integrity flags and held references | 0 integrity flags and 0 held references this week | 50 | 93 | email only | 2 / 0 | — |
| `data_unusual_export` | An unusual number of named files | 6 named files in an hour from one tribe leader | 72 | 81 | email only | 2 / 0 | — |
| `director_demand_gap` | Members are waiting where no leader is ready | 0 members are waiting for a tribe with no leader | 56 | 97 | email only | 2 / 0 | — |
| `director_interview_booked` | An interview was booked | An interview was booked | 48 | 70 | email only | 2 / 0 | — |
| `director_interview_no_outcome` | An interview has no outcome recorded | Ada’s interview has no outcome yet | 53 | 81 | email only | 2 / 0 | — |
| `director_interviews_tomorrow` | Interviews tomorrow | Tomorrow: 1 interview | 45 | 68 | email only | 2 / 0 | — |
| `director_offer_answered` | A leader offer was answered | Someone declined a leader offer | 43 | 80 | email only | 2 / 0 | — |
| `director_offer_unanswered` | An offer has had no answer | An offer to Ngozi has had no answer | 46 | 84 | email only | 2 / 0 | — |
| `director_removal_escalated` | A request about a member's place has waited a week | A request about a member’s place has waited a week | 72 | 95 | email only | 2 / 0 | — |
| `director_season_countdown` | A season is about to open | Season 1 opens in 0 days | 39 | 59 | email only | 2 / 0 | — |
| `director_slots_low` | Interview times are running out | Only 0 interview times left | 46 | 74 | email only | 2 / 0 | — |
| `director_unplaced` | Members finished the form and have no tribe | 0 members still have no tribe | 59 | 68 | email only | 2 / 0 | — |
| `office_assistant_recommended` | A leader recommended an assistant leader | An assistant leader was recommended | 42 | 116 | email only | 2 / 0 | — |
| `pastor_card_overdue` | Tribe Cards are waiting for review | 1 Tribe Card waiting for review | 50 | 73 | email only | 2 / 0 | — |
| `pastor_card_review` | A Tribe Card is ready for review | Builders Tribe is ready for review | 49 | 76 | email only | 2 / 0 | — |
| `pastor_decision_overdue` | Applications are waiting a long time for a decision | 1 application waiting for a decision | 58 | 72 | email only | 2 / 0 | — |
| `pastor_decision_ready` | An application is ready for a pastor's decision | An application is ready for your decision | 52 | 77 | email only | 2 / 0 | — |
| `pastor_fit_model_waiting` | A new fit model is waiting for approval | A new fit model is waiting for approval | 50 | 81 | email only | 2 / 0 | — |
| `pastor_referee_concern` | A referee raised a concern | A referee raised a concern | 63 | 62 | email only | 2 / 0 | — |
| `pastor_reference_held` | A reference is held for a look | A reference is held for a look | 50 | 74 | email only | 2 / 0 | — |
| `pastor_season_review` | A season ends in two weeks | Season 1 ends in 14 days | 44 | 69 | email only | 2 / 0 | — |
| `pastor_stage_review` | A leader asked to change their stage of life | Ngozi Okafor asked to change their approved | 71 | 86 | email only | 2 / 0 | — |
| `pastor_templates_waiting` | Ready-made cards are waiting for sign-off | 0 ready-made cards wait for sign-off | 51 | 82 | email only | 2 / 0 | — |
| `reminder_paused` | A reminder journey has paused itself | A reminder journey paused itself | 65 | 135 | email only | 2 / 0 | app |
| `report_ready` | A report is ready | Pray with expectation, not performance:  | 61 | 91 | `ut_report_ready` | 2 / 0 | database |
| `signin_paused` | WhatsApp sign-in codes have paused themselves | WhatsApp sign-in codes are paused | 70 | 134 | email only | 2 / 0 | — |
| `signin_stop_alert` | Someone replied STOP or “not me” to a sign-in code | Someone replied to a WhatsApp sign-in code | 57 | 148 | email only | 2 / 0 | — |
| `staff_digest` | Your daily or weekly summary of what is waiting | 0 things waiting for you | 48 | 60 | email only | 2 / 0 | app, database |
| `staff_escalation` | Something has waited too long | 1 approved | 47 | 45 | email only | 2 / 0 | — |
| `staff_role_welcome` | You now hold a new role | You now hold the tribe leader role | 67 | 69 | email only | 2 / 0 | — |
| `whatsapp_paused` | WhatsApp messages have paused themselves | WhatsApp messages are paused | 100 | 151 | email only | 2 / 0 | — |
| `whatsapp_signal` | Meta has sent news about the church's WhatsApp | Meta has sent news about WhatsApp | 71 | 124 | email only | 2 / 0 | — |
| `whatsapp_test` | A test message, sent by a person in the office to themselves | A test message from United Tribes | 48 | 101 | `ut_whatsapp_test` | 1 / 0 | database |

## For referee

| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `referee_code` | A referee's six-digit code | 482913 is your code for the reference | 62 | 65 | `ut_referee_code` | 0 / 0 | database |
| `referee_reminder` | A reminder before the reference link stops working | A reminder: someone is waiting for your reference | 65 | 49 | email only | 0 / 0 | — |
| `referee_request` | A reference is requested | Ngozi Okafor has asked you to speak for them | 132 | 196 | `ut_referee_request` | 1 / 0 | database |
| `referee_reverify` | A referee is asked to confirm a reference they gave | Please confirm your reference for Ngozi Okafor | 102 | 172 | `ut_referee_reverify` | 1 / 0 | database |
| `referee_thanks` | Thank you for your reference | Thank you for your reference | 53 | 28 | email only | 0 / 0 | — |

## Messages nothing queues by name

81 of the messages are not named in any database function or application file as a quoted name. Most are queued from a generic function that builds the name (the notices, the reminders), and a person can confirm each by looking where the message log shows it: `admin_application_sent`, `admin_checklist_overdue`, `admin_data_request`, `admin_data_request_due`, `admin_email_health`, `admin_messages_failing`, `admin_queue_stuck`, `admin_reporting_failed`, `admin_role_changed`, `applicant_referee_slow`, `applicant_reference_in`, `applicant_still_with_us`, `application_approved`, `application_approved_declaration`, `application_approved_open`, `application_approved_optional`, `application_interview_booked`, `application_interview_invited`, `application_not_approved`, `application_received`, `care_age_ask`, `care_asks_waiting`, `care_callbacks_due`, `care_removal_appeal`, `care_removal_ask`, `care_removal_waiting`, `care_teen_confirm`, `champion_month`, `champion_waiting`, `coach_card_submitted`, `coach_details_unanswered`, `coach_leader_stalled`, `coach_new_leader`, `coach_practice_ready`, `coach_removal_ask`, `coach_removal_waiting`, `data_integrity_week`, `data_unusual_export`, `director_demand_gap`, `director_interview_booked`, `director_interview_no_outcome`, `director_interviews_tomorrow`, `director_offer_answered`, `director_offer_unanswered`, `director_removal_escalated`, `director_season_countdown`, `director_slots_low`, `director_unplaced`, `leader_academy_next`, `leader_assistant_added`, `leader_card_approved`, `leader_card_changes`, `leader_check_clear_open`, `leader_check_clear_optional`, `leader_next_season`, `leader_seats`, `leader_tribe_open`, `leader_workshop_tomorrow`, `member_deletion_done`, `member_deletion_received`, `member_meeting_changed`, `member_testimony_shared`, `office_assistant_recommended`, `pastor_card_overdue`, `pastor_card_review`, `pastor_decision_overdue`, `pastor_decision_ready`, `pastor_fit_model_waiting`, `pastor_referee_concern`, `pastor_reference_held`, `pastor_season_review`, `pastor_stage_review`, `pastor_templates_waiting`, `referee_reminder`, `referee_thanks`, `signin_paused`, `signin_stop_alert`, `staff_escalation`, `staff_role_welcome`, `whatsapp_paused`, `whatsapp_signal`.
