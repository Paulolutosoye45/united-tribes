# Wording that people agreed to before the new names

When "circle" became "tribe" and "tribe" became "community", the sentences people agree to were reworded and their version
labels were raised. This page keeps the **old sentences exactly as they were shown**, so that a record in the consent ledger
that carries an old version label can always be matched to the words that person saw.

Nobody is asked to agree again. Existing records keep their old labels; only new agreements carry the new ones.

The words changed, not the meaning: each sentence below is the same promise with "circle" read as "tribe". Consent wording is a
legal matter under the Nigeria Data Protection Act, so please ask your lawyer to confirm that a rename does not call for a fresh
agreement before you go live. If they say it does, the change is small: raise the version label again and ask members to
confirm when they next sign in (the places are listed at the end).

## Matching and contact consent: shown while the member filled in the form

| Version label | Where | Sentence |
|---|---|---|
| `2026-11-v2` (before) | Matching consent | I agree that The Covenant Nation may use my answers, including my faith journey, to match me to a circle and to contact me about it. |
| `2026-12-v3` (now) | Matching consent | I agree that The Covenant Nation may use my answers, including my faith journey, to match me to a tribe and to contact me about it. |
| `2026-11-v2` (before) | WhatsApp consent | You may message me on WhatsApp about my circle. |
| `2026-12-v3` (now) | WhatsApp consent | You may message me on WhatsApp about my tribe. |

The sentence about the AI service did not mention either word, so it is unchanged (its label moved with the others).

## The agreement a member gives when they take a place

Shown on the page where a member accepts the group they were matched with, and when they accept a swap.

Version label `2026-11-c1` (before):

1. I will come to my circle each week, on time, or tell my leader early if I cannot.
2. I will keep what is shared in my circle private.
3. I will pray for the people in my circle and take one small step toward my goal each week.
4. I will help my circle refine its Success Picture in week 1, and I will say honestly in week 12 whether we got there.

Agreement sentence: *I agree to this Success Picture and to the Circle Covenant. I understand my leader will see my name and, if I
said yes to WhatsApp, my number.*

Version label `2026-12-c2` (now): the same four promises and sentence, reading "tribe" and "Tribe Covenant".

## What a parent or guardian agrees to for a young member

Version label `2026-12-g1` (before):

1. United Tribes is a programme of The Covenant Nation. Members meet in a small group of about twelve for twelve weeks, to pray, talk and take one small step toward a goal each week.
2. A circle for young people is led by two adults who have completed our leader training and been interviewed and approved by our pastors. There are always two adults present.
3. We will only place your child in a circle for their own age group. We will never place them in an adult circle.
4. Your child’s name, and the number they choose to share, will be seen by the leaders of their circle, and by the coach and the Care Team who look after it.
5. Once your child has a place, this same page shows you their circle’s leaders, and the day, time and place it meets.
6. A member of our Care Team will phone or write to you, using the details we were given, to check that this answer is really yours. Your child cannot be placed in a circle until we have spoken to you.
7. We use the answers your child gave about themselves, including their faith journey, only to match them to a circle and to contact them about it. We do not share them outside the programme, and you can ask the Care Team to delete them.
8. You can take your permission back at any time, by the same link. Your child will then leave the circle straight away.
9. We keep your contact details only for as long as they are needed for this, then delete them. *(Never used either word, so it did not change.)*

Version label `2026-12-g2` (now): the same nine statements, reading "tribe" for "circle".

## Where the current wording and labels live

| What | File |
|---|---|
| Matching, AI and WhatsApp consent, `CONSENT_VERSION` | `src/lib/intake/consent.ts` |
| Tribe agreement, `AGREEMENT_VERSION` | `src/lib/matching/wording.ts` |
| Guardian consent, `GUARDIAN_CONSENT_VERSION` | `src/lib/guardian/consent.ts` |
| Leader application consent (no change: it never used either word) | `src/lib/leaders/consent.ts` |

If you do decide members must confirm again, raise the label in the file, and ask for the answer on the page that records it
(`/join` for the form and `/profile` for the consent switches).
