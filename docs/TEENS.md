# Tribes for young people (13 to 17)

**Status: built, tested, and switched off.** A young person cannot join a tribe until the church has done the steps in
"Before you open it". Nothing in the software replaces the church's own child-protection policy; it enforces the parts
a database can enforce and gives the Care Team the tools for the parts a person has to do.

## What the software enforces

These are rules in the database (`supabase/migrations/20261205000100_learn_scale.sql`), not only in the screens, so a
bug or a hand-made request cannot get around them. Each has a test in `tests/db/teens.test.ts`.

| Rule | How |
| --- | --- |
| The track stays closed until you open it | A platform switch (`teen_track`) that only the database owner can turn on. The Admin screens cannot. A profile for a 13 to 17 year old is refused while it is off. |
| A parent or guardian says yes first | The young person gives their parent or guardian's name and email or phone. A private link goes to *that* address or number. The young person never sees the link, and cannot use their own email or number. |
| A person confirms it was really them | After the parent says yes, the Care Team phones them and records the call (who, when, a note). Until then the young person sees no tribes and cannot take a seat. |
| Only the right tribe | A young person is only offered tribes on the teens track; adults are never offered those. "Happy in a neighbouring age group" never applies to the teens track, in either direction. |
| Two adults | A tribe for young people is only offered if it has an assistant as well as a leader. The Care Team screen lists any tribe with young people in it that has only one adult. |
| Permission can be taken back | The same link lets the parent take their permission back. The young person leaves their tribe at once, any open request to change tribe is withdrawn, and the Care Team is told. |
| Nothing is sent to an AI service | The assistant that helps adults write their story is switched off for under-18s, on the screen and again on the server. Voice notes too. |
| The link is not kept | Only a fingerprint of the link is stored. Once the email or message is sent, the copy in the outbox is erased, and a message that has lost its link can never be retried. |
| Contact details are not kept forever | `guardian_retention(90)` deletes a parent or guardian's contact details 90 days after the young person's last season ends (and never while they are in a tribe). **The nightly job must call it** (see "Operating it"). |
| A "no" is final unless the Care Team reopens it | After a no, the young person cannot ask again by themselves. If the family has talked, the Care Team can let them start again. |

## What the software cannot do

- **It cannot verify anyone's age.** A person chooses their own age range. Someone under 18 who chooses an adult range
  is treated as an adult. The form shows no hint of what this does, on purpose. Leaders and coaches are the safeguard:
  anyone who seems younger than the age they gave should be spoken to.
- **It cannot verify that the person who answers the link is the parent.** The phone call is the check. Do the call.
- **It cannot vet leaders.** Certification covers the Academy and the panel's interview. For teen tribes the church
  should add whatever its own policy requires (references, a record check, extra training) before it certifies a leader
  or assistant for the teens track.
- **It does not replace legal advice.** The wording a parent agrees to (`src/lib/guardian/consent.ts`) was written
  to match what the software does, in plain English. It has not been reviewed by a lawyer.

## Before you open it

Do these in order. Do not skip the first two.

1. **The church's child-protection policy** is agreed by the pastors, and the Care Lead and a named safeguarding lead
   are ready to do the calls.
2. **Have a lawyer review the wording** a parent sees (`GUARDIAN_STATEMENTS` and `GUARDIAN_AGREE_SENTENCE` in
   `src/lib/guardian/consent.ts`) and the privacy notice against the Nigeria Data Protection Act, which gives children's
   data extra protection. If the meaning of any sentence changes, **change `GUARDIAN_CONSENT_VERSION`**; the version a
   parent saw is stored with their answer.
3. **Certify at least one leader and one assistant** for a teens tribe, with whatever extra checks the policy needs.
   Have them build a tribe card on the teens track once it is open. The two-adult rule means a tribe with no
   assistant is never shown to a young person.
4. **Decide who does the calls** and make sure they have the Care Lead role, and that the Care Lead's email or WhatsApp
   works (a parent's "yes" messages them).
5. **Open the track** (in the database, as the owner; this cannot be done from the app):

   ```sql
   update public.platform_flags set enabled = true where key = 'teen_track';
   update public.tracks set active = true where slug = 'teens';
   ```

   The first statement must come first: the second is refused otherwise.
6. **Try it once with a real family you trust**, end to end, before announcing it.

To close it again, set the track inactive (`update public.tracks set active = false where slug = 'teens'`) and the
platform switch off. Young people already in tribes stay where they are; no new profile for under-18s is accepted.

## The call-back procedure (for the Care Team)

1. Open **Young people** under Care (the Admin page links to it too). Each parent who has said yes is under **To phone**.
2. Phone the number given (or write to the email) and say who you are. Do not read out anything the young person told us.
3. Check that you are speaking to the person named, that they are the young person's parent or legal guardian, and that
   they did say yes to this. If they did not, or you are not sure, do **not** record the call. Leave it, and tell the
   Care Lead. A parent can say no from the same link.
4. Record the call with a short note (who you spoke to, when). This is what lets the young person see tribes.
5. A "no" or a withdrawal appears under **Said no**. Do not push. If the family later changes its mind, **Let them ask
   again** opens a fresh request.

## Operating it

- **The daily clean-up** removes a parent's contact details 90 days after the young person's last season ended. It runs by
  itself inside the heartbeat (docs/RETENTION.md); there is nothing to call. If the heartbeat stops, a parent's contact
  details are kept longer than the wording says, so watch it (docs/OPERATIONS.md, "Watching it").
- **Messages**: a parent's link goes by email or SMS to the address or number given, using the same sending service as
  every other message. If email is not set up, a parent never receives the link; check `/api/health` before opening.
- **Logs**: requests, answers, calls and reopenings are written to the event log without any personal detail.
