-- Placement, part 0: one more thing a member can agree to (their name, email and WhatsApp number shown to the leader of the tribe they
-- join). Postgres will not let a new enum value be used in the same transaction that adds it, so the value is added here and used from
-- the next file.
alter type public.consent_purpose add value if not exists 'team_contact';
