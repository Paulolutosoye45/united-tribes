-- A leader can see the tribe they lead, and the people who have joined it, whichever way they came to lead.
--
-- What was wrong: the "Lead a tribe" page decides what to show from the leader's application, or from an active appointment. A leader who
-- holds the leader role but has neither (the role was given directly, for example by an invitation) was shown "Lead another tribe. Start my
-- application", with an approved Tribe Card and members behind it. The same happened to an appointed leader on a database that did not yet
-- have my_appointment(). Nothing was wrong with the cards or the members; the page never asked whether the person leads a tribe.
--
-- What changes (one addition, nothing replaced, nothing rewritten, no data touched):
--   my_leading()  the tribe the signed-in leader leads (or, for an assistant leader, the one they assist): its name, where its card stands,
--                 how many people have joined and whether the person is certified. The count is the leader's own list, with the two rules that
--                 list already keeps (a member the church placed is not shown before they are told, and a member who asked to keep their details
--                 private is not shown), so this page can never show a leader someone their own page does not. It says nothing about who
--                 appointed them, any note, or any application. Null when there is no such tribe, and for anyone who is not a leader.
--
-- Way back: supabase/rollback/20270101000200_leading_view.down.sql

create function public.my_leading()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  t public.tribes;
  v_role text;
  v_members integer := 0;
begin
  if me is null or not public.is_trainee() then
    return null;
  end if;

  -- The tribe they lead. An approved card is the one that has people, so it comes first; then the newest.
  select * into t from public.tribes x where x.leader_id = me and x.status <> 'closed'
   order by (x.status = 'approved') desc, x.created_at desc limit 1;
  if found then
    v_role := 'leader';
  else
    select * into t from public.tribes x where x.assistant_id = me and x.status <> 'closed'
     order by (x.status = 'approved') desc, x.created_at desc limit 1;
    if not found then
      return null;
    end if;
    v_role := 'assistant';
  end if;

  -- Only an approved card has people. The count is read through the leader's own list, so its rules apply. A count that cannot be read
  -- is nought: this page must never fail for want of a number.
  if t.status = 'approved' then
    begin
      v_members := coalesce(jsonb_array_length(public.tribe_roster_marked(t.id) -> 'members'), 0);
    exception when others then
      v_members := 0;
    end;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'tribe_id', t.id,
    'tribe_name', t.name,
    'tribe_status', t.status,
    'members', v_members,
    'certified', exists (select 1 from public.leader_certifications c where c.person_id = me));
end;
$$;

revoke execute on function public.my_leading() from public, anon;
grant execute on function public.my_leading() to authenticated;
