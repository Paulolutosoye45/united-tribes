import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_RANGES } from "@/lib/god/desk-open";

// The Leader Desk, Phase 2b-2 (Open tribe, the pastors' reminder, the pipeline and its limits) is reached by the owner's screens and nowhere else. These checks read
// the source so that stays true: every owner action checks the owner and the shape of what it was given before the database is asked, only three owner functions
// are called, the website never places or emails anyone itself, the database makes the seats through the office's own function and accepts no warning, and the
// reminder goes only to the pastors, only for a tribe the Desk formed, and only once.

const ROOT = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const actions = read("src/app/(app)/god/leader-desk/open-actions.ts");
const page = read("src/app/(app)/god/leader-desk/page.tsx");
const loaders = read("src/lib/god/desk-server.ts");
const parsers = read("src/lib/god/desk-open.ts");
const openTribe = read("src/components/god/DeskOpenTribe.tsx");
const pipeline = read("src/components/god/DeskPipeline.tsx");
const settings = read("src/components/god/DeskPipelineSettings.tsx");
const groupCard = read("src/components/god/DeskGroupCard.tsx");
const sql = read("supabase/migrations/20270119000100_desk_open.sql");
const rollback = read("supabase/rollback/20270119000100_desk_open.down.sql");

const OWNER_FUNCTIONS = ["desk_open_preview", "desk_open_tribe", "desk_pipeline_settings_set"];
const body = (src: string, header: RegExp) => src.slice(src.search(header)).split(/\n\$\$;/)[0];

describe("the owner's actions for opening a tribe and the limits", () => {
  const names = [...actions.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);
  const bodyOf = (n: string) => actions.slice(actions.indexOf(`export async function ${n}(`)).split(/\nexport async function /)[0];

  it("are exactly three, and each refuses anyone but the unlocked owner before the database is asked", () => {
    expect([...names].sort()).toEqual(["openTribeAction", "previewOpenAction", "saveLimitsAction"]);
    for (const n of names) expect(bodyOf(n), n).toMatch(/if \(!\(await ownerOnly\(\)\)\) return NOT_AVAILABLE;/);
    expect(actions).toContain('session?.god === "open"');
  });

  it("check the shape of every id, number and reason before the database is asked", () => {
    expect(bodyOf("previewOpenAction")).toContain("isUuid(group)");
    expect(bodyOf("openTribeAction")).toContain("isUuid(group)");
    const save = bodyOf("saveLimitsAction");
    expect(save).toContain("Number.isInteger(n)");
    expect(save).toContain('typeof reason !== "string"');
    expect(save).toContain("checkSettings(");
  });

  it("call only the three owner functions", () => {
    const called = [...actions.matchAll(/run(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(OWNER_FUNCTIONS));
    expect(called).toHaveLength(3);
  });

  it("only ever revalidate the Desk's own page, and only when something was changed", () => {
    expect(actions).toContain('const PAGES = ["/god/leader-desk"]');
    expect(actions).not.toMatch(/revalidatePath|redirect|cookies|headers|console\./);
    expect(actions).toMatch(/run\("desk_open_preview", \{ p_group: group \}, \[\]\)/);
    expect(actions).toMatch(/run\("desk_open_tribe", \{ p_group: group \}, PAGES\)/);
  });

  it("never reach for anything that places, seats, sends, queues, appoints or approves, and never read a table", () => {
    const all = [actions, parsers, openTribe, pipeline, settings].join("\n");
    expect(all).not.toMatch(/\b(placement_one_place|placement_one_move|placement_office|placement_check|choose_tribe|enqueue_message|notify_person|notify_role|queue_message|send_message|god_appoint_leader|leader_appoint_core|save_tribe_card|review_tribe_card|worker_desk)\b/i);
    expect(all).not.toMatch(/\.from\("/);
    expect(all).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe("the screens", () => {
  it("read the pipeline through one read, and show it, the limits and Open tribe where the groups are", () => {
    expect(loaders).toContain('rpc("desk_pipeline"');
    expect(page).toContain("loadDeskPipeline(");
    expect(page).toContain("<DeskPipeline ");
    expect(page).toContain("<DeskPipelineSettings ");
    expect(groupCard).toContain("<DeskOpenTribe");
    // Open tribe is only offered to a group that has a leader
    expect(groupCard).toMatch(/leader\.leader \? <DeskOpenTribe/);
  });

  it("make the owner look first and confirm second, and say in Rehearsal that nobody is placed", () => {
    expect(openTribe.indexOf("await previewOpenAction(group)")).toBeGreaterThan(0);
    expect(openTribe.indexOf("await previewOpenAction(group)")).toBeLessThan(openTribe.indexOf("await openTribeAction(group)"));
    expect(openTribe).toMatch(/rehearsal/i);
    expect(openTribe).toContain("O.confirm");
    expect(openTribe).toContain("O.confirmRehearsal");
    expect(openTribe).toContain("setSure(true)");
    // and nobody can be placed for real while Placement is not On
    expect(openTribe).toContain("preview.placementOn");
    expect(openTribe).toContain("O.placementOff");
  });

  it("name each person left alone, with the reason, and show no phone number anywhere", () => {
    expect(openTribe).toContain("result.notPlaced");
    expect(openTribe).toContain("O.left");
    for (const src of [openTribe, pipeline, settings, parsers]) expect(src).not.toMatch(/phone|tel:|whatsapp|wa\.me|e164/i);
  });

  it("show stuck groups first, with a mark, and the stage in words", () => {
    expect(pipeline).toContain("P.stuckTag");
    expect(pipeline).toContain("P.stages[r.stage]");
    expect(pipeline).toContain('data-stuck={r.stuck ? "yes" : "no"}');
    const rows = body(sql, /create function public\.desk_pipeline\(\)/);
    expect(rows).toContain("order by j.stuck desc");
  });

  it("are among the Desk screens the Phase 1 guard scans", () => {
    const names = readdirSync(join(ROOT, "src/components/god")).filter((f) => f.startsWith("Desk"));
    for (const f of ["DeskOpenTribe.tsx", "DeskPipeline.tsx", "DeskPipelineSettings.tsx"]) expect(names).toContain(f);
  });
});

describe("Open tribe, in the database", () => {
  const open = body(sql, /create function public\.desk_open_tribe\(/);

  it("places each member by the office's own function, once each, accepting nothing and giving no reason of its own", () => {
    expect([...open.matchAll(/placement_one_place\(/g)]).toHaveLength(1);
    expect(open).toContain("placement_one_place((r.m ->> 'person_id')::uuid, g.tribe_id, '{}'::text[], null, false)");
    // the Desk makes no seat of its own
    expect(sql).not.toMatch(/insert\s+into\s+public\.(tribe_members|placement_runs|placement_items|placement_teams)/i);
    expect(sql).not.toMatch(/update\s+public\.tribe_members/i);
  });

  it("checks the group again in the database: the owner, a leader, an approved card and a certified leader", () => {
    expect(open).toContain("perform public.desk_need()");
    expect(open).toContain("desk_open_plan(p_group)");
    const plan = body(sql, /create function public\.desk_open_plan\(/);
    for (const code of ["no_group", "archived", "no_leader", "closed", "card", "not_certified"]) expect(plan, code).toContain(`'${code}'`);
    expect(plan).toContain("leader_certifications");
    expect(plan).toContain("placement_check_core(");
  });

  it("places for real only when the Desk is On and Placement is On, and in Rehearsal only counts", () => {
    expect(open).toMatch(/if v_mode = 'on' and public\.placement_mode\(\) <> 'on' then/);
    expect(open).toMatch(/if v_mode = 'rehearsal' then\s+v_would := v_would \+ 1;/);
    expect(open).toContain("if v_mode = 'on' then");
  });

  it("lets one person's refusal stop nobody else, and archives the draft only when nobody is left", () => {
    expect(open).toMatch(/exception when others then/);
    expect(open).toContain("case when v_left = 0 then 'archived' else status end");
  });

  it("writes one line to the log, with counts and no names, and nothing to any message itself", () => {
    expect(open).toContain("write_event(auth.uid(), 'desk.open_tribe', 'desk_group', p_group::text,");
    expect(open).toContain("jsonb_build_object('placed', v_placed, 'would', v_would, 'not_placed', v_left, 'rehearsal', v_mode = 'rehearsal')");
    expect(open).not.toMatch(/enqueue_message|queue_message|insert\s+into\s+public\.messages|notify_person/i);
  });

  it("is closed to everyone but a signed-in session, and its helpers to everyone", () => {
    const closed = [...sql.matchAll(/revoke all on function([\s\S]*?)from public, anon, authenticated;/gi)].map((m) => m[1]).join("\n");
    for (const fn of ["desk_open_words", "desk_open_plan", "desk_card_tick"]) expect(closed, fn).toContain(`public.${fn}(`);
    for (const fn of ["desk_open_words", "desk_open_plan", "desk_card_tick"]) expect(sql, fn).not.toMatch(new RegExp(`grant execute on function[^;]*public\\.${fn}\\(`, "i"));
    const granted = [...sql.matchAll(/grant execute on function([\s\S]*?)to authenticated;/gi)].map((m) => m[1]).join("\n");
    for (const fn of OWNER_FUNCTIONS.concat(["desk_pipeline"])) expect(granted, fn).toContain(`public.${fn}(`);
    // the grants of the owner's functions never reach anon
    expect(sql).not.toMatch(/grant execute on function[^;]*\bto\b[^;]*\banon\b/i);
  });
});

describe("the pastors' reminder, in the database", () => {
  const tick = body(sql, /create function public\.desk_card_tick\(\)/);

  it("runs only while the Desk is On, never in Rehearsal", () => {
    expect(tick).toMatch(/if public\.leader_desk_any\(\) <> 'on' then\s+return 0;/);
  });

  it("goes to the pastors and directors, through the notice system, never as an instant message, and never to the leader whose card it is", () => {
    expect(tick).toContain("array['pastor', 'director']");
    expect(tick).toContain("'pastor_card_waiting'");
    expect(tick).toMatch(/'\/review\/cards', false, t\.leader_id\)/);
    expect(tick).not.toMatch(/insert\s+into\s+public\.messages|enqueue_message|queue_message/i);
  });

  it("is for a tribe the Desk formed, a day after the card was sent in, and not for a card that has been waiting for more than two weeks", () => {
    expect(tick).toContain("x.status = 'submitted'");
    expect(tick).toContain("x.submitted_at <= now() - interval '24 hours'");
    expect(tick).toContain("x.submitted_at > now() - interval '14 days'");
    expect(tick).toContain("exists (select 1 from public.desk_groups g where g.tribe_id = x.id)");
  });

  it("is once for each time the card was sent in, because the notice's own name carries the tribe and the time it was sent in", () => {
    expect(tick).toContain("'cardwait:' || t.id || ':' || extract(epoch from t.submitted_at)::bigint");
  });

  it("puts no names in the notice but the tribe's and the leader's first name, and a failing tribe stops no other", () => {
    expect(tick).toContain("jsonb_build_object('tribe', t.name, 'leader', public.first_name_of(t.leader_id))");
    expect(tick).toMatch(/exception when others then\s+null;/);
  });

  it("runs on the Desk's heartbeat", () => {
    expect(body(sql, /create or replace function public\.desk_tick\(\)/)).toContain("v_cards := public.desk_card_tick()");
  });
});

describe("the limits, in the database", () => {
  const set = body(sql, /create function public\.desk_pipeline_settings_set\(/);

  it("keep the ranges the form checks, each stated once", () => {
    const [oLo, oHi] = PIPELINE_RANGES.offerHours;
    const [bLo, bHi] = PIPELINE_RANGES.backups;
    const [yLo, yHi] = PIPELINE_RANGES.saidYesDays;
    const [cLo, cHi] = PIPELINE_RANGES.cardDays;
    expect(set).toContain(`p_offer_hours not between ${oLo} and ${oHi}`);
    expect(set).toContain(`p_backups not between ${bLo} and ${bHi}`);
    expect(set).toContain(`p_said_yes_days not between ${yLo} and ${yHi}`);
    expect(set).toContain(`p_card_days not between ${cLo} and ${cHi}`);
    expect(set).toContain("char_length(v_reason) < 3 or char_length(v_reason) > 300");
  });

  it("are the owner's, need a reason, and write the numbers to the log without the reason", () => {
    expect(set).toContain("perform public.desk_need()");
    expect(set).toContain("reason = v_reason");
    const event = set.slice(set.indexOf("write_event("));
    expect(event).toContain("'desk.settings'");
    expect(event).not.toMatch(/v_reason|p_reason/);
  });
});

describe("the way back", () => {
  it("puts back the two functions it replaced, drops what it added, and removes no data", () => {
    for (const fn of ["desk_interest_check", "desk_tick"]) expect(rollback, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    for (const fn of ["desk_open_words", "desk_open_plan", "desk_open_preview", "desk_open_tribe", "desk_card_tick", "desk_pipeline", "desk_pipeline_settings_set"]) {
      expect(rollback, fn).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`));
    }
    expect(rollback).toContain("alter table if exists public.desk_groups drop column if exists opened_at");
    // the statements of the file itself; the bodies of the functions it puts back are the old ones (the database test compares them with the database as it was)
    const code = rollback.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "$$$$");
    expect(code).not.toMatch(/\b(truncate|delete)\b/i);
  });

  it("says in its first lines what stays: seats Open tribe made, drafts it archived, reminders already sent, settings", () => {
    const head = rollback.slice(0, 1500);
    expect(head).toMatch(/placed by Open tribe stay placed/);
    expect(head).toMatch(/stays archived/);
    expect(head).toMatch(/stays sent/);
    expect(head).toMatch(/settings the owner changed stay/);
  });
});
