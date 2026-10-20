/**
 * A fingerprint of everything that belongs to the people who already hold the leader or assistant leader role: their roles,
 * applications, references, reviews, scores, tribes, certificates, declarations, practice sign-offs, Academy progress and bookings,
 * and the members of the tribes they lead. One line per person and one overall fingerprint.
 *
 *   npx tsx scripts/leaders-checksum.ts postgres://user:pass@host:port/database
 *
 * Run it before and after each phase, on the same data. The two outputs must be identical: Phase A changes how new applications
 * and new leaders are handled, and must never rewrite or withdraw anything a current leader has.
 */
import { createHash } from "node:crypto";
import { Client } from "pg";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Give the database address: npx tsx scripts/leaders-checksum.ts postgres://user:pass@host:port/database");
  process.exit(2);
}

// Each table, and how its rows are tied to a person who holds the role.
const TABLES: { table: string; where: string }[] = [
  { table: "person_roles", where: "x.person_id = p.person_id" },
  { table: "leader_applications", where: "x.person_id = p.person_id" },
  { table: "leader_references", where: "x.application_id in (select a.id from public.leader_applications a where a.person_id = p.person_id)" },
  { table: "leader_reviews", where: "x.application_id in (select a.id from public.leader_applications a where a.person_id = p.person_id)" },
  { table: "leader_assessments", where: "x.application_id in (select a.id from public.leader_applications a where a.person_id = p.person_id)" },
  { table: "tribes", where: "p.person_id in (x.leader_id, x.assistant_id)" },
  { table: "leader_certifications", where: "x.person_id = p.person_id" },
  { table: "safeguarding_declarations", where: "x.person_id = p.person_id" },
  { table: "practice_assessments", where: "x.person_id = p.person_id" },
  { table: "academy_progress", where: "x.person_id = p.person_id" },
  { table: "academy_attempts", where: "x.person_id = p.person_id" },
  { table: "academy_bookings", where: "x.person_id = p.person_id" },
  { table: "tribe_members", where: "x.tribe_id in (select t.id from public.tribes t where p.person_id in (t.leader_id, t.assistant_id))" },
];

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  const people = (await c.query("select distinct person_id from public.person_roles where role in ('leader', 'assistant_leader') order by 1")).rows.map((r) => r.person_id as string);
  const overall = createHash("sha256");
  for (const person of people) {
    const parts: string[] = [];
    for (const t of TABLES) {
      const { rows } = await c.query(
        `select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h
           from public.${t.table} x, (select $1::uuid as person_id) p where ${t.where}`,
        [person],
      );
      parts.push(`${t.table}=${rows[0].n}:${rows[0].h.slice(0, 8)}`);
    }
    const line = `${person} ${parts.join(" ")}`;
    const lineHash = createHash("sha256").update(line).digest("hex").slice(0, 12);
    overall.update(line);
    console.log(`${line} => ${lineHash}`);
  }
  console.log(`LEADERS ${people.length}`);
  console.log(`FINGERPRINT ${overall.digest("hex")}`);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
