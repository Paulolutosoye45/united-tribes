// Builds the two files in supabase/repair/ from the migration and rollback files. Run: node scripts/build-repair.mjs
// (tests/unit/repair-files.test.ts fails if the committed files are not what this script writes, so a changed rollback file cannot leave them stale.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG = path.join(ROOT, "supabase/migrations");
const RB = path.join(ROOT, "supabase/rollback");
const OUT = path.join(ROOT, "supabase/repair");
const FIRST = "20270114000100"; // Package 6b, the first file of the group that went in out of order
const stamp = (f) => f.slice(0, 14);

export function build() {
const downs = fs.readdirSync(RB).filter((f) => f.endsWith(".down.sql") && stamp(f) >= FIRST).sort().reverse();
const ups = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && stamp(f) >= FIRST).sort();

// Tables the undo can drop = the tables the files from FIRST onward create (plain `create table` at the start of a line).
const tables = new Set();
for (const f of ups) {
  for (const m of fs.readFileSync(path.join(MIG, f), "utf8").matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gim)) tables.add(m[1]);
}
const list = [...tables].sort();

const count = `-- Repair, step 1 of 3: LOOK before you undo anything. This file only reads; it changes nothing.
--
-- The undo in step 2 drops the tables listed here (they belong to the files from ${FIRST} onward). This lists each one that exists, how many rows it
-- holds, and how many a fresh install holds (a settings table starts with its one row of standard settings; every other table starts empty).
-- If the last column says "nothing to lose" on every line (or the list is empty), the undo loses nothing but standard settings.
-- If any line says "HAS DATA - STOP", do not run step 2: send the list to Claude.
--
-- Written by scripts/build-repair.mjs. Do not edit it by hand.

select t.tbl as "table",
       n.rows as "rows",
       t.fresh as "fresh install holds",
       case when n.rows <= t.fresh then 'nothing to lose' else 'HAS DATA - STOP' end as "verdict"
from (values
${list.map((t) => `  ('${t}', ${t.endsWith("_settings") ? 1 : 0})`).join(",\n")}
) as t(tbl, fresh)
cross join lateral (
  select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.tbl), false, true, '')))[1]::text::int as rows
  where to_regclass('public.' || t.tbl) is not null
) as n
order by 1;
`;

const undo = `-- Repair, step 2 of 3: UNDO the files from ${FIRST} onward, newest first, in one go.
--
-- Use this when supabase/check-applied.sql shows some of the files from ${FIRST} to 20270120000100 as MISSING while later ones (20270121000100 and
-- after) are applied: the files went in out of order, so the later ones were built on a base that is not there.
-- It runs the ${downs.length} way-back files in the order they must run (${stamp(downs[0])} down to ${stamp(downs[downs.length - 1])}). Each file is safe to run when its
-- feature is only partly there or not there at all, and each one runs in its own transaction.
--
-- Before you run it: take a backup (Supabase > Database > Backups), and run step 1 (1-count-before-undo.sql) and read the numbers.
-- Afterwards the database is where it stood just before ${FIRST}: run step 3 (apply the files ${FIRST} to 20270126000100 one at a time, in order).
-- Every switch on the Switchboard that belongs to these files is gone with them and comes back Off when its file is applied again.
--
-- Written by scripts/build-repair.mjs from supabase/rollback/. Do not edit it by hand.

${downs.map((f) => `-- ===== ${f} =====\n${fs.readFileSync(path.join(RB, f), "utf8").trimEnd()}\n`).join("\n")}
`;

  return { count, undo, tables: list.length, downs: downs.length, ups: ups.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = build();
  fs.writeFileSync(path.join(OUT, "1-count-before-undo.sql"), r.count);
  fs.writeFileSync(path.join(OUT, "2-undo-from-20270126-to-20270114.sql"), r.undo);
  console.log(`wrote ${r.tables} tables, ${r.downs} down files, ${r.ups} up files`);
}
