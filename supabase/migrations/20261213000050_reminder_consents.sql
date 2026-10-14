-- Messages & Reminders, part 1: two more things a person can say yes or no to.
--
-- "reminders" (nudges about something they started) and "announcements" (messages from the office) join the consent
-- ledger beside "email" and "whatsapp", so the history of every yes and no is kept in one place. Both are on until the
-- person says otherwise, exactly as email is. (Postgres will not let a new enum value be used in the same transaction
-- that adds it, so the values are added here and used from the next file.)

alter type public.consent_purpose add value if not exists 'reminders';
alter type public.consent_purpose add value if not exists 'announcements';
