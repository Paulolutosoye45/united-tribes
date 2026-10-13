import type { Client } from "pg";

export type Seeded = Record<string, string>;

/** The people every journey starts with. Emails starting admin., pastor., etc. also get that role from the stand-in. */
export async function seedPeople(q: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>): Promise<Seeded> {
  const ids: Seeded = {};
  async function mk(key: string, email: string, name: string, roles: string[], application?: { status: "approved_leader" | "approved_assistant"; answers: object }) {
    const { rows } = await q("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]);
    const id = rows[0].id as string;
    await q("update public.people set full_name = $2, preferred_name = $3 where id = $1", [id, name, name.split(" ")[0]]);
    for (const role of roles) {
      await q("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [id, role]);
    }
    if (application) {
      await q("insert into public.leader_applications (person_id, status, answers, consent_version, decided_at) values ($1, $2::public.application_status, $3::jsonb, '2026-10-l1', now())", [id, application.status, JSON.stringify(application.answers)]);
    }
    ids[key] = id;
  }
  await mk("ngozi", "ngozi@example.org", "Ngozi Okafor", ["leader"], {
    status: "approved_leader",
    answers: { calling: { track: "builders", community: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: "direction" }, contact: { whatsapp: "+2348031111111" } },
  });
  await mk("kemi", "kemi@example.org", "Kemi Balogun", ["assistant_leader"], {
    status: "approved_assistant",
    answers: { calling: { track: "builders", community: "professionals" }, style: { leadBest: "listening" }, contact: { whatsapp: "+2348032222222" } },
  });
  await mk("member", "member@example.org", "Chidi Eze", []);
  await mk("pastor", "pastor.ife@example.org", "Pastor Ife Adeyemi", ["pastor"]);
  await mk("director", "director.bola@example.org", "Bola Johnson", ["director"]);
  await mk("coach", "coach.sade@example.org", "Sade Williams", ["coach"]);
  await mk("care", "care_lead.dayo@example.org", "Dayo Akin", ["care_lead"]);
  await mk("admin", "admin.mary@example.org", "Mary Ogedengbe", ["admin"]);
  return ids;
}

export type { Client };
