# Fix 8, the weekly guide opens for leaders on the Saturday before its week, the leader FAQ, the drafts and the read-through sheet: how to apply

Everything before must already be applied. This package only needs the earlier weekly page (`tribe_week`), which is in the migrations already.

**The release has a setting and starts Off.** Until you turn it On on **Admin → Weekly guides**, a leader can open any week, exactly as now. Applying the files changes nothing a leader sees except one new page in the **How to use this app** library.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270123000100_guide_release.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('guide_release_weekly','guide_opens_at','guide_open_week','guide_release_view','guide_release_get','guide_release_set');`
   It should say **6**.
   `select weekly, release_hour, release_minute from public.guide_release_settings;` should say **false, 8, 0**.
3. **Then the website.**

Run the database file **first**. If the website goes out first, **Admin → Weekly guides** simply does not show the new setting, and a leader's page is as it was.

The file replaces one function, `tribe_week` (the leader's weekly page). Its old text is in the rollback file, so you can go back exactly.

## What it does

**On Admin → Weekly guides**, a new box, **When leaders can read the next week**:

- **Off** (the start): a leader can open any week.
- **On**: the next week's guide opens for leaders **the day before it starts** (a Saturday, when the season starts on a Sunday), at the time you choose, Lagos time (8 am to start). Week 1 is open from the first day. Before the time, a leader reads this week and the weeks already open. A later week shows **Week N has not opened yet**, says when it opens, and shows none of its content.
- Under this week, a leader reads **Next week's guide opens on Saturday 14 November, 8 am.**
- Pastors and directors can always read every week, so the guides can be read through before they open.
- Admin, director and pastor change it; the data lead can read it.

The rule is kept in the database function behind the leader's weekly page, so no screen and no direct call can read a week early. It decides only what a leader's page shows: nothing is sent, and no member sees any difference.

**A new page in How to use this app, Questions leaders ask** (five questions, answers first: finishing the Tribe Card, when a leader sees their members, why a number is not showing yet, how to admit people to the WhatsApp group, and what to do when someone says no). It is offered to leaders on every Lead page, after the page's own guide.

**Two sheets for you, not for the platform** (in `docs/`):

- `READ-THROUGH-WEEKS-1-3.md`: exactly what a leader reads for weeks 1, 2 and 3, read straight from the database, with a place to approve or mark each week. Teaching wording is yours; nothing was changed.
- `LEADER-ANNOUNCEMENTS.md`: drafts to paste into **Admin → Announcements**: Foundation of Faith waived this season only (and the setting to match it), when the next week opens, a note for week 2, and a heads-up for the seat rules.

## Check it works (ten minutes)

1. **Admin → Weekly guides** shows **When leaders can read the next week**, Off. Turn it **On** at the time you want, and save.
2. As a leader, open **This week**: this week's guide is there, and under the weeks, **Next week's guide opens on …**. Change the address to `?week=` followed by a later week number: the page says **Week N has not opened yet** and shows none of its content.
3. As a pastor, open the same address: the later week is readable.
4. Turn it back **Off**: the leader reads every week again.
5. Open **How to use this app** on the Lead page as a leader: **Questions leaders ask** is offered. Read it once yourself; it is a draft until you have.

## Known limits (so nobody is surprised)

- The confession, the sermon title, the skill-share prompt and the goal idea (the small layer above each guide, its own function) are hidden on the leader's screen for a week that has not opened, but they are **not** hidden in the database: only the guide itself is. They are not secret, and are shown to members as the weeks come.
- "Saturday" is the **day before the week starts**. For a season that starts on a Sunday, as every season so far, that is a Saturday. For a season that starts on another day, it is the day before that week begins, and the page names the real day and date.
- The time is set to the quarter hour.
- The coach and the assistant leader are treated as leaders: they read only the weeks that have opened. If you would rather the coach could always read ahead, say so.
- The WhatsApp group for leaders stays a person's job: you create the group and post its link where leaders will see it. The call sheet on **Leader cards** gives you the numbers to add. Sending WhatsApp messages in bulk needs Meta's approval and your access token, so it is outside this package.
- The Questions leaders ask page is words only, with no pictures.

## Go back

Run `supabase/rollback/20270123000100_guide_release.down.sql`. It puts the earlier `tribe_week` back exactly, and removes the six functions and the setting. Every leader can open any week again. Put the website files back before you run it.
