-- Way back from assistant recommendations: the recommending stops, nothing else changes
--
-- Drops every function that migration 20261226000200 added. The table assistant_recommendations is LEFT as it is, with every row, so no
-- recommendation and no decision is lost. Assistants already paired STAY paired (the tribe keeps its assistant_id): that is the same field
-- the review panel's pair_assistant sets, and it is the panel's to change.
-- To remove the table as well, after this file:   drop table public.assistant_recommendations;
-- Roll the application files back first (the Assistants page and the leader's Recommend card call these functions).
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop function if exists worker_assistant_tick(text);
drop function if exists assistant_tick();
drop function if exists assistant_decide(uuid,boolean,text,boolean);
drop function if exists assistant_row(uuid);
drop function if exists assistant_requests();
drop function if exists assistant_apply_pair(uuid,boolean);
drop function if exists assistant_my_state(uuid);
drop function if exists assistant_withdraw(uuid);
drop function if exists assistant_recommend(uuid,uuid,text,text);
drop function if exists assistant_can_decide(uuid);
drop function if exists assistant_tribe_young(uuid);

commit;
