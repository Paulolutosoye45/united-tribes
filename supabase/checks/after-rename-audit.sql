-- AFTER THE TRIBES RENAME: a read-only check you can run in the Supabase SQL editor once the upgrade is done.
-- It changes nothing. It answers two questions.
--
--   1. Does any table, column, function, type or view in the database still carry the old word?   (Expected: no rows.)
--   2. Where does the old word still appear INSIDE stored text?                                    (Expected: only words people typed.)
--
-- Question 2 is where you will see group names that leaders typed themselves (for example "Builders Circle") and any
-- sentence a member wrote. Those are deliberately left exactly as typed. To rename a group, use the app (a leader can edit the
-- name while the group is a draft; the office can change it from the group page) or run an UPDATE of your own after you have
-- looked at the list below.

-- 1. Structure --------------------------------------------------------------------------------------------------------------
select 'table or view' as kind, n.nspname || '.' || c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'bi') and c.relkind in ('r', 'v', 'm') and c.relname ~* 'circle'
union all
select 'column', n.nspname || '.' || c.relname || '.' || a.attname
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'bi') and c.relkind in ('r', 'v', 'm') and a.attnum > 0 and not a.attisdropped and a.attname ~* 'circle'
union all
select 'function', p.oid::regprocedure::text
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   and (p.proname ~* 'circle' or pg_get_functiondef(p.oid) ~* 'circle')
union all
select 'type or enum value', t.typname || coalesce('.' || e.enumlabel, '')
  from pg_type t left join pg_enum e on e.enumtypid = t.oid
 where t.typnamespace = 'public'::regnamespace and (t.typname ~* 'circle' or e.enumlabel ~* 'circle')
order by 1, 2;

-- 2. Stored text --------------------------------------------------------------------------------------------------------------
-- One row per column that still has the word somewhere in its text: how many rows, and which words (each shown once).
select t.table_name || '.' || t.column_name as "column",
       (xpath('/row/n/text()', x))[1]::text::int as "rows with the word",
       (xpath('/row/words/text()', x))[1]::text as "words found"
  from (
    select c.table_name, c.column_name,
           query_to_xml(
             format($q$select count(*) as n,
                               (select string_agg(distinct w, ', ') from (select unnest(regexp_matches(%I::text, %L, 'gi')) as w
                                                                           from public.%I where %I::text ~* 'circle' limit 200) s) as words
                          from public.%I where %I::text ~* 'circle'$q$,
                    c.column_name, '([A-Za-z0-9_.:-]*circle[A-Za-z0-9_.:-]*)', c.table_name, c.column_name, c.table_name, c.column_name),
             false, true, '') as x
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'ARRAY', 'USER-DEFINED')
  ) t
 where (xpath('/row/n/text()', x))[1]::text::int > 0
 order by 1;
