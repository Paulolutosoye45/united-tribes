-- Way back from "Remove a member from a tribe, from Admin".
--
-- Drops the six functions this change added and the table of what the office did (and its reasons), and puts the one function it replaced (the heartbeat's
-- removal round) back exactly as it stood. No seat, member, hold, message or consent is changed or deleted: a person the office took out of a tribe stays
-- out of it, and keeps the hold they were given (it ends by itself after its three days).
-- The table of blocked tribes keeps the rows the office made, but each one is lifted (nothing can put the removal back once the screens are gone, so
-- nothing is left blocked for good): the matching may offer that tribe to them again. As in the earlier files, the column this change added there stays
-- where it is (so does `request_id` being allowed to be empty, with its one-block-per-request rule as a unique index): nothing reads them once this has run.
-- Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;

drop function if exists public.admin_remove_member(uuid, uuid, text);
drop function if exists public.admin_put_back(uuid);
drop function if exists public.admin_tribe_members(uuid);
drop function if exists public.admin_removal_person(uuid);
drop function if exists public.admin_removal_lately(uuid, uuid);

create or replace function public.worker_removal_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.removal_tick();
end;
$$;

drop function if exists public.admin_removal_tidy();

-- The office's own blocks are lifted (if the table of blocked tribes is still there: the way back from the leader's requests takes it away), and the
-- office's table goes
do $$
begin
  if to_regclass('public.removal_blocks') is not null then
    update public.removal_blocks set lifted_at = coalesce(lifted_at, now()) where request_id is null;
  end if;
end;
$$;
drop table if exists public.admin_removals;

commit;
