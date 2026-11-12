-- Corrects one sentence on the Leader Desk's "Recommend as leader" button. When no draft group exists the button said "Start one on the Groups tab", but the Desk has no
-- Groups tab: draft groups are started on the Proposals tab (Start a draft group). The fixed text is also in 20270125000100_desk_extras.sql, so a database that applies that
-- file now has it already; this file is for a database that applied it before the fix. It replaces one function (desk_person_lead_options) with the same text, apart from that
-- sentence. It changes no table, no row and no switch, and running it twice changes nothing. Run it as the database owner.
--
-- Written from 20270125000100_desk_extras.sql; tests/db/repair-files.test.ts fails if the two ever differ.

create or replace function public.desk_person_lead_options(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g record;
  v_rows jsonb := '[]'::jsonb;
  v_why text;
  v_code text;
  v_drafts integer := 0;
begin
  perform public.desk_need();
  if not exists (select 1 from public.people p where p.id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  for g in select x.id, x.name, c.name as community, sg.title as goal
             from public.desk_groups x
             left join public.communities c on c.id = x.community_id
             left join public.season_goals sg on sg.id = x.season_goal_id
            where x.status = 'draft' and x.leader_id is null
            order by x.created_at desc, x.id limit 24 loop
    v_drafts := v_drafts + 1;
    if public.desk_offer_problem(g.id) is not null then
      v_why := coalesce(v_why, public.desk_offer_problem(g.id));
      continue;
    end if;
    v_code := public.desk_offer_gate(p_person, g.id);
    if v_code is not null then
      v_why := coalesce(v_why, public.desk_offer_words(v_code));
      continue;
    end if;
    if jsonb_array_length(v_rows) < 12 then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('group_id', g.id, 'name', g.name, 'community', g.community, 'goal', g.goal));
    end if;
  end loop;
  return jsonb_build_object(
    'rows', v_rows,
    'why', case when jsonb_array_length(v_rows) > 0 then null
                when v_drafts = 0 then 'There is no draft group waiting for a leader. Start one on the Proposals tab (Start a draft group).'
                else v_why end);
end;
$$;
