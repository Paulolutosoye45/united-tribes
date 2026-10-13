# Connecting Power BI, Looker or any reporting tool

The platform keeps a separate copy of its numbers in a schema called `bi`, built for reporting tools. It is refreshed once a
day by the heartbeat and any time an admin, director or data lead presses **Refresh now** in Admin → Sending and reporting.

## What is in it

| View | One row per | Use it for |
| --- | --- | --- |
| `bi.members` | member in a season | community, track, goal, degree of compatibility, attendance, belonging, Success Picture gain, steps, whether thriving, form minutes |
| `bi.tribes` | tribe | members, meetings held, attendance rate, thriving rate, gain, verdict, coach, leader certified |
| `bi.weekly` | tribe and week | meeting date, present, marked, steps set |
| `bi.care_weekly` | week and kind of care task | how many were opened and closed |
| `bi.messages_daily` | day, channel, template, status | message volumes |
| `bi.ai_fields` | season and form field | how often the assistant's suggestion was kept |
| `bi.kpi_daily` | season and day | the headline numbers, against the targets |

## What is deliberately not in it

No names, no email addresses or phone numbers, no free text and nothing from the care or support notes. Each person is a code
(`member_key`) made with a secret salt that only the database owner can read, so the code cannot be turned back into a name and
cannot be matched to another system. The views hold one row per person-code, so the in-app dashboards' small-group rule
(Targets → "Smallest group shown") is **not** applied to them: a report that breaks the numbers down very finely can still
point to a handful of people. Apply the same rule in the report itself, and share it only with people who may see
member-level results.

## Connecting

The role `bi_reader` is created by the migrations and cannot log in by itself. Create a login for each tool and give it that
role (run once, as the database owner, in the SQL editor):

```sql
create role powerbi login password 'a-long-random-password';
grant bi_reader to powerbi;
```

Then connect with the database's host, port and database name from the hosting dashboard (use the *session* pooler, or the
direct connection, not the transaction pooler, for scheduled refresh in Power BI), user `powerbi`, and ask for the `bi`
schema. `powerbi` can read the seven views and nothing else; it cannot see any other table or schema. To remove access,
`drop role powerbi;`.

## Keeping it fresh

The views are materialised: a dashboard reads yesterday's refresh, not live rows. If you need today's numbers before the
daily run, press **Refresh now**. The screen shows when the copy was last filled and how many rows each view holds.
