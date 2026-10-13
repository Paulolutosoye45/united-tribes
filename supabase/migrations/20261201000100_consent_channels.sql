-- Stage 2, part 1: two more things a person can agree to.
--
-- WhatsApp was already in the ledger. Email and SMS join it so that every
-- channel the platform writes on has a recorded yes or no. (Postgres will not
-- let a new enum value be used in the same transaction that adds it, so the
-- value is added here and used from the next file.)

alter type public.consent_purpose add value if not exists 'email';
alter type public.consent_purpose add value if not exists 'sms';
