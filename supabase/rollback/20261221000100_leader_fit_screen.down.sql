-- Way back from Phase 6 (the Find your tribe screen): the two hooks do nothing again
--
-- Phase 6 replaced the bodies of leader_fit_ready() and leader_fit_gate(uuid), the two do-nothing hooks Phase 2 made.
-- After this file the send gate never stops anyone, and the Tribe fit switch cannot be turned On (leader_fit_ready() is false).
-- Run this BEFORE the Phase 3 and Phase 2 files.
--
-- Puts back the body each of these functions had before the migration, with the same name, the same arguments and the same permissions:
--   leader_fit_gate, leader_fit_ready
-- Tables, columns, settings and every row are left exactly as they are. Nothing is deleted or changed. Press Full process on the Admin page
-- first (the first way back); this file is the second, for when a function itself misbehaves.
-- Run it as the database owner, once. Running it twice changes nothing.

begin;

CREATE OR REPLACE FUNCTION public.leader_fit_gate(p_app uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.leader_fit_ready()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select false;
$function$;

-- No trigger was added by Phase 6, so there is nothing to drop. Switch Tribe fit Off on the Admin page first (the first way back).

commit;
