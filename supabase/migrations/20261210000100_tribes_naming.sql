-- United Tribes, Stage 10: new names. A "circle" is now a "tribe", and a "tribe" is now a "community".
--
--   before:  tribe (one of 11 interest areas)    ->   after:  community
--   before:  circle (a group of up to 12)        ->   after:  tribe
--
-- This file RENAMES. It never drops a table, a column or a row. Everybody who has already filled in the form, been
-- matched, joined a group, logged a week or received a message keeps all of it, under the new names.
--
-- What it changes, in order:
--   1. Remembers how many rows every table has and a checksum of every row, to prove at the end that nothing was lost.
--   2. Renames tables, columns, types, enum values, constraints, indexes, triggers and policies (interest areas first,
--      then groups, so the two never collide).
--   3. Re-creates the 160 or so functions that mention the old words, so every rule inside them speaks the new names
--      (and every function keeps exactly the permissions it had). The BI copy (schema "bi") is rebuilt the same way.
--   4. Updates the stored words the application itself wrote: saved answers (keys inside the form drafts, leader
--      applications, match reasons and weights, reports, message parameters), event names, and the wording of the
--      training and weekly guides. Words that PEOPLE typed (names of groups, stories, notes, testimonies) are not touched.
--   5. Checks its own work and stops, undoing everything, if a row is missing, a row it should not have touched has
--      changed, or an old name is left behind.
--
-- The change itself runs as one statement (the DO block below), so it is all or nothing. The mapping from old words to new is one rule (the functions
-- ut_rn1 and ut_rn2 below), applied the same way to everything, and checked by tests/db/tribes-naming.test.ts.
--
-- Run it in a quiet hour, and deploy the new application straight after: the application and the database must be the
-- same version (see UPGRADE-TRIBES.md).

-- No time limit may cut this short (the SQL editor and the connection pooler have their own), and it must not wait for ever behind
-- somebody else's work: after a minute without getting the locks it needs, it gives up and changes nothing. Both are put back at the end.
set statement_timeout = 0;
set lock_timeout = '60s';

do $migration$
declare
  r record;
  rx record;
  v_old text;
  v_new text;
  v_sql text;
  v_oid oid;
  v_phase int;
  v_pat text;
  v_n bigint;
  v_sum numeric;
  v_has_deps boolean;
  v_prose_cols text[][] := array[
    ['academy_modules', 'lesson'], ['academy_modules', 'outcome'], ['academy_modules', 'practice'],
    ['academy_questions', 'explanation'], ['academy_questions', 'options'], ['academy_questions', 'prompt'],
    ['goal_ideas', 'idea'], ['platform_flags', 'note'], ['community_prompts', 'skill_share'],
    ['week_guides', 'big_idea'], ['week_guides', 'leader_tip'], ['week_guides', 'opening_question'],
    ['week_guides', 'plan'], ['week_guides', 'practice'], ['week_guides', 'prayer'], ['week_guides', 'questions'],
    ['week_guides', 'step_hint'], ['centre_settings', 'value'], ['reports', 'summary']
  ];
  v_token_cols text[][] := array[
    ['event_log', 'action'], ['event_log', 'entity'], ['ai_calls', 'field'], ['intake_drafts', 'step'],
    ['testimonies', 'share_with'], ['testimonies', 'status'], ['reports', 'kind'],
    ['match_recommendations', 'reasons'], ['tribes', 'fixed']
  ];
  v_token_json_cols text[][] := array[['event_log', 'meta'], ['reports', 'data'], ['kpi_snapshots', 'data']];
  v_i int;
  v_tbl text;
  v_col text;
  v_mode text;
  v_data_type text;
  v_touched text[] := '{}';
begin
  -- 0. Guards ---------------------------------------------------------------------------------------------------
  if to_regclass('public.circles') is null or to_regclass('public.tribes') is null then
    raise exception 'Expected the tables circles and tribes. Has this migration already been applied?';
  end if;
  if to_regclass('public.communities') is not null then
    raise exception 'The table communities already exists. This migration has probably already been applied.';
  end if;
  perform set_config('check_function_bodies', 'off', true);
  perform set_config('lock_timeout', '60s', true);
  perform set_config('search_path', 'public, pg_catalog', true);

  -- 1. The one rule that maps old words to new ----------------------------------------------------------------------
  -- Stage 1: tribe -> community.  Stage 2: circle -> tribe.  "United Tribes" (the programme's name) is left alone.
  execute $f$
    create function pg_temp.ut_rn1(t text) returns text language plpgsql immutable as $b$
    declare u text := chr(1);
    begin
      if t is null then return null; end if;
      t := regexp_replace(t, '(united[ _-]?t)(ribes?)', '\1' || u || '\2', 'gi');
      t := regexp_replace(t, '(?<![A-Za-z])tribes(?![a-z])', 'communities', 'g');
      t := regexp_replace(t, '(?<![A-Za-z])tribe(?![a-z])', 'community', 'g');
      t := regexp_replace(t, 'Tribes(?![a-z])', 'Communities', 'g');
      t := regexp_replace(t, 'Tribe(?![a-z])', 'Community', 'g');
      t := regexp_replace(t, '(?<![A-Z])TRIBES(?![A-Z])', 'COMMUNITIES', 'g');
      t := regexp_replace(t, '(?<![A-Z])TRIBE(?![A-Z])', 'COMMUNITY', 'g');
      return replace(t, u, '');
    end $b$
  $f$;
  execute $f$
    create function pg_temp.ut_rn2(t text) returns text language plpgsql immutable as $b$
    declare u text := chr(1);
    begin
      if t is null then return null; end if;
      t := regexp_replace(t, '(united[ _-]?t)(ribes?)', '\1' || u || '\2', 'gi');
      t := regexp_replace(t, '(?<![A-Za-z])circles(?![a-z])', 'tribes', 'g');
      t := regexp_replace(t, '(?<![A-Za-z])circle(?![a-z])', 'tribe', 'g');
      t := regexp_replace(t, 'Circles(?![a-z])', 'Tribes', 'g');
      t := regexp_replace(t, 'Circle(?![a-z])', 'Tribe', 'g');
      t := regexp_replace(t, '(?<![A-Z])CIRCLES(?![A-Z])', 'TRIBES', 'g');
      t := regexp_replace(t, '(?<![A-Z])CIRCLE(?![A-Z])', 'TRIBE', 'g');
      return replace(t, u, '');
    end $b$
  $f$;
  execute $f$
    create function pg_temp.ut_rn(t text) returns text language sql immutable as
    $b$ select pg_temp.ut_rn2(pg_temp.ut_rn1(t)) $b$
  $f$;
  -- Inside stored JSON: rename every key; mode 'keys' leaves the values alone, 'tokens' also renames values that are
  -- plain lower-case identifiers (not names or sentences), 'prose' renames every text value.
  execute $f$
    create function pg_temp.ut_rn_json(j jsonb, mode text) returns jsonb language plpgsql immutable as $b$
    declare k text; v jsonb; o jsonb; s text;
    begin
      if j is null then return null; end if;
      case jsonb_typeof(j)
        when 'object' then
          o := '{}'::jsonb;
          for k, v in select key, value from jsonb_each(j) loop
            o := o || jsonb_build_object(pg_temp.ut_rn(k), pg_temp.ut_rn_json(v, mode));
          end loop;
          return o;
        when 'array' then
          select coalesce(jsonb_agg(pg_temp.ut_rn_json(e, mode) order by ord), '[]'::jsonb) into o
            from jsonb_array_elements(j) with ordinality as t(e, ord);
          return o;
        when 'string' then
          s := j #>> '{}';
          if mode = 'prose' or (mode = 'tokens' and s ~ '^[a-z0-9_.:-]+$') then return to_jsonb(pg_temp.ut_rn(s)); end if;
          return j;
        else return j;
      end case;
    end $b$
  $f$;

  -- 2. Proof of what is there now: row counts and a checksum of every row, for every table --------------------------
  create temp table ut_before (oid oid primary key, n bigint, chk numeric) on commit drop;
  for r in select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format($q$select count(*), coalesce(sum(('x' || substr(md5(t::text), 1, 15))::bit(60)::bigint::numeric), 0) from public.%I t$q$, r.relname)
      into v_n, v_sum;
    insert into ut_before values (r.oid, v_n, v_sum);
  end loop;

  -- 3. Remember everything that has to be rebuilt, before anything is renamed ---------------------------------------
  create temp table ut_fn on commit drop as
    select p.oid as old_oid, p.proname as old_name, p.proargtypes as argtypes, p.proargnames as old_argnames,
           pg_get_functiondef(p.oid) as def, p.proacl as acl, obj_description(p.oid, 'pg_proc') as cmt
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')   -- not an extension's
       and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) ~* '(circle|tribe)';

  create temp table ut_mv on commit drop as
    select c.oid as old_oid, c.relname as old_name, pg_get_viewdef(c.oid, true) as def, c.relispopulated as populated,
           c.relacl as acl, obj_description(c.oid, 'pg_class') as cmt
      from pg_class c where c.relnamespace = 'bi'::regnamespace and c.relkind = 'm';
  create temp table ut_mv_idx on commit drop as
    select i.indexdef from pg_indexes i join pg_class c on c.relname = i.tablename and c.relnamespace = 'bi'::regnamespace and c.relkind = 'm'
     where i.schemaname = 'bi';

  create temp table ut_pol on commit drop as
    select p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
      from pg_policies p where p.schemaname = 'public'
       and (p.policyname ~* '(circle|tribe)' or coalesce(p.qual, '') ~* '(circle|tribe)' or coalesce(p.with_check, '') ~* '(circle|tribe)');

  -- Checks whose text holds an old word inside quotes: they are dropped now and put back, with new words, after the data moves.
  create temp table ut_chk on commit drop as
    select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.contype = 'c' and c.connamespace = 'public'::regnamespace
       and pg_get_constraintdef(c.oid) ~* '''[^'']*(circle|tribe)[^'']*''';
  for r in select * from ut_chk loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- 4. The BI copy is rebuilt later, from its own definitions; drop it now so nothing depends on the old functions ---
  for r in select * from ut_mv loop
    execute format('drop materialized view bi.%I', r.old_name);
  end loop;

  -- Policies whose own text names an old word (there are none today; this keeps the migration honest if one is added).
  for r in select * from ut_pol where coalesce(qual, '') ~* '(circle|tribe)' or coalesce(with_check, '') ~* '(circle|tribe)' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  -- 5. Rename the structure. Phase 1 moves "tribe" out of the way (-> community); phase 2 moves "circle" in (-> tribe) --
  for v_phase in 1..2 loop
    v_pat := case v_phase when 1 then 'tribe' else 'circle' end;

    -- enum values (labels)
    for r in select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typnamespace = 'public'::regnamespace and e.enumlabel ~* v_pat loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.enumlabel) else pg_temp.ut_rn2(r.enumlabel) end;
      execute format('alter type public.%I rename value %L to %L', r.typname, r.enumlabel, v_new);
    end loop;
    -- enum types
    for r in select t.typname from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' and t.typname ~* v_pat loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.typname) else pg_temp.ut_rn2(r.typname) end;
      execute format('alter type public.%I rename to %I', r.typname, v_new);
    end loop;
    -- tables
    for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname ~* v_pat order by c.relname loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.relname) else pg_temp.ut_rn2(r.relname) end;
      execute format('alter table public.%I rename to %I', r.relname, v_new);
    end loop;
    -- columns
    for r in select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped and a.attname ~* v_pat
              order by c.relname, a.attnum loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.attname) else pg_temp.ut_rn2(r.attname) end;
      execute format('alter table public.%I rename column %I to %I', r.relname, r.attname, v_new);
    end loop;
    -- constraints (a primary key or unique constraint renames its index too)
    for r in select c.conrelid::regclass::text as tbl, c.conname from pg_constraint c
              where c.connamespace = 'public'::regnamespace and c.conname ~* v_pat order by 1, 2 loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.conname) else pg_temp.ut_rn2(r.conname) end;
      execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, v_new);
    end loop;
    -- indexes that are not behind a constraint
    for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'i' and c.relname ~* v_pat order by 1 loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.relname) else pg_temp.ut_rn2(r.relname) end;
      execute format('alter index public.%I rename to %I', r.relname, v_new);
    end loop;
    -- triggers
    for r in select t.tgrelid::regclass::text as tbl, t.tgname from pg_trigger t
              where not t.tgisinternal and t.tgname ~* v_pat and t.tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.tgname) else pg_temp.ut_rn2(r.tgname) end;
      execute format('alter trigger %I on %s rename to %I', r.tgname, r.tbl, v_new);
    end loop;
    -- policies (names)
    for r in select p.schemaname, p.tablename, p.policyname from pg_policies p where p.schemaname = 'public' and p.policyname ~* v_pat loop
      v_new := case v_phase when 1 then pg_temp.ut_rn1(r.policyname) else pg_temp.ut_rn2(r.policyname) end;
      execute format('alter policy %I on %I.%I rename to %I', r.policyname, r.schemaname, r.tablename, v_new);
    end loop;
  end loop;

  -- 6. Functions. Interest-area names first, then group names, then those whose names stay but whose bodies change ----
  for r in select * from ut_fn order by
             case when old_name ~* 'tribe' then 1 when old_name ~* 'circle' then 2 else 3 end, old_name loop
    v_new := pg_temp.ut_rn(r.old_name);
    v_sql := pg_temp.ut_rn(r.def);
    if v_new = r.old_name and pg_temp.ut_rn(coalesce(array_to_string(r.old_argnames, ','), '')) = coalesce(array_to_string(r.old_argnames, ','), '') then
      -- only the body changes: replace it in place (permissions stay)
      execute v_sql;
    else
      select exists (select 1 from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = r.old_oid and d.deptype = 'n') into v_has_deps;
      if v_has_deps and pg_temp.ut_rn(coalesce(array_to_string(r.old_argnames, ','), '')) <> coalesce(array_to_string(r.old_argnames, ','), '') then
        raise exception 'Function public.% has dependants and changes its parameter names; the migration needs a rule for it', r.old_name;
      end if;
      if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_new and p.proargtypes = r.argtypes and p.oid <> r.old_oid) then
        raise exception 'Function public.% already exists with the same arguments', v_new;
      end if;
      if v_has_deps then
        execute format('alter function %s rename to %I', r.old_oid::regprocedure, v_new);
        execute v_sql;
      else
        execute format('drop function %s', r.old_oid::regprocedure);
        execute v_sql;
        select p.oid into v_oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_new and p.proargtypes = r.argtypes;
        -- give back exactly the permissions the old function had, and no others
        for rx in select ax.grantee as g from pg_proc p, aclexplode(p.proacl) ax where p.oid = v_oid and ax.grantee <> p.proowner and ax.grantee <> 0 loop
          execute format('revoke all on function %s from %I', v_oid::regprocedure, (select rolname from pg_roles where oid = rx.g));
        end loop;
        execute format('revoke all on function %s from public', v_oid::regprocedure);
        if r.acl is not null then
          for rx in select ax.grantee as g from aclexplode(r.acl) ax where ax.privilege_type = 'EXECUTE' loop
            if rx.g = 0 then
              execute format('grant execute on function %s to public', v_oid::regprocedure);
            elsif rx.g <> (select proowner from pg_proc where oid = v_oid) then
              execute format('grant execute on function %s to %I', v_oid::regprocedure, (select rolname from pg_roles where oid = rx.g));
            end if;
          end loop;
        end if;
        if r.cmt is not null then
          execute format('comment on function %s is %L', v_oid::regprocedure, pg_temp.ut_rn(r.cmt));
        end if;
      end if;
    end if;
  end loop;

  -- 7. The BI copy, rebuilt with the new names and the same permissions --------------------------------------------
  for r in select * from ut_mv order by old_name loop
    v_new := pg_temp.ut_rn(r.old_name);
    execute format('create materialized view bi.%I as %s with %s data', v_new, regexp_replace(pg_temp.ut_rn(r.def), ';\s*$', ''), case when r.populated then '' else 'no' end);
    if r.acl is not null then
      for rx in select ax.grantee as g, ax.privilege_type as pt from aclexplode(r.acl) ax loop
        if rx.g <> 0 and rx.g <> (select relowner from pg_class where relname = v_new and relnamespace = 'bi'::regnamespace) then
          execute format('grant %s on bi.%I to %I', rx.pt, v_new, (select rolname from pg_roles where oid = rx.g));
        end if;
      end loop;
    end if;
    if r.cmt is not null then execute format('comment on materialized view bi.%I is %L', v_new, pg_temp.ut_rn(r.cmt)); end if;
  end loop;
  for r in select * from ut_mv_idx loop
    execute pg_temp.ut_rn(r.indexdef);
  end loop;

  -- Policies that had to be dropped for their text: put back
  for r in select * from ut_pol where coalesce(qual, '') ~* '(circle|tribe)' or coalesce(with_check, '') ~* '(circle|tribe)' loop
    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      pg_temp.ut_rn(r.policyname), r.schemaname, pg_temp.ut_rn(r.tablename), r.permissive, r.cmd, array_to_string(r.roles, ', '),
      case when r.qual is not null then 'using (' || pg_temp.ut_rn(r.qual) || ')' else '' end,
      case when r.with_check is not null then 'with check (' || pg_temp.ut_rn(r.with_check) || ')' else '' end);
  end loop;

  -- 8. The words the application itself stored -----------------------------------------------------------------------
  -- Triggers are switched off on a table while its rows are updated, so "last changed" times and side effects are left alone.
  -- Words people typed are never touched: only the columns below, and the keys inside stored JSON.

  -- 8a. Keys inside every stored JSON column; values too where the column holds identifiers or prose.
  for r in select c.table_name, c.column_name from information_schema.columns c
            join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.data_type = 'jsonb' order by 1, 2 loop
    v_mode := 'keys';
    for v_i in 1..array_length(v_token_json_cols, 1) loop
      if v_token_json_cols[v_i][1] = r.table_name and v_token_json_cols[v_i][2] = r.column_name then v_mode := 'tokens'; end if;
    end loop;
    for v_i in 1..array_length(v_prose_cols, 1) loop
      if v_prose_cols[v_i][1] = r.table_name and v_prose_cols[v_i][2] = r.column_name then v_mode := 'prose'; end if;
    end loop;
    execute format('select count(*) from public.%I where %I::text ~* ''(circle|tribe)''', r.table_name, r.column_name) into v_n;
    if v_n > 0 then
      execute format('alter table public.%I disable trigger user', r.table_name);
      execute format('update public.%I set %I = pg_temp.ut_rn_json(%I, %L) where %I::text ~* ''(circle|tribe)''',
                     r.table_name, r.column_name, r.column_name, v_mode, r.column_name);
      execute format('alter table public.%I enable trigger user', r.table_name);
      v_touched := v_touched || r.table_name;
    end if;
  end loop;

  -- 8b. Text columns that hold the application's own words, one whole value at a time
  for v_i in 1..array_length(v_token_cols, 1) loop
    v_tbl := v_token_cols[v_i][1];
    v_col := v_token_cols[v_i][2];
    select data_type into v_data_type from information_schema.columns where table_schema = 'public' and table_name = v_tbl and column_name = v_col;
    if v_data_type is null then continue; end if;
    execute format('alter table public.%I disable trigger user', v_tbl);
    if v_data_type = 'ARRAY' then
      execute format('update public.%I set %I = (select coalesce(array_agg(pg_temp.ut_rn(x) order by ord), ''{}'') from unnest(%I) with ordinality as u(x, ord)) where %I::text ~* ''(circle|tribe)''',
                     v_tbl, v_col, v_col, v_col);
    else
      execute format('update public.%I set %I = pg_temp.ut_rn(%I) where %I ~* ''(circle|tribe)''', v_tbl, v_col, v_col, v_col);
    end if;
    execute format('alter table public.%I enable trigger user', v_tbl);
    v_touched := v_touched || v_tbl;
  end loop;
  -- the one sentence the swap function wrote as a reason
  alter table public.tribe_members disable trigger user;
  update public.tribe_members set release_reason = 'moved to another tribe' where release_reason = 'moved to another circle';
  alter table public.tribe_members enable trigger user;
  v_touched := v_touched || 'tribe_members'::text;

  -- 8c. Training, guides, vision, report summaries: text the office and the platform wrote
  for v_i in 1..array_length(v_prose_cols, 1) loop
    v_tbl := v_prose_cols[v_i][1];
    v_col := v_prose_cols[v_i][2];
    select data_type into v_data_type from information_schema.columns where table_schema = 'public' and table_name = v_tbl and column_name = v_col;
    if v_data_type is null or v_data_type = 'jsonb' then continue; end if;   -- stored JSON was done in 8a
    execute format('alter table public.%I disable trigger user', v_tbl);
    if v_data_type = 'ARRAY' then
      execute format('update public.%I set %I = (select coalesce(array_agg(pg_temp.ut_rn(x) order by ord), ''{}'') from unnest(%I) with ordinality as u(x, ord)) where %I::text ~* ''(circle|tribe)''',
                     v_tbl, v_col, v_col, v_col);
    else
      execute format('update public.%I set %I = pg_temp.ut_rn(%I) where %I ~* ''(circle|tribe)''', v_tbl, v_col, v_col, v_col);
    end if;
    execute format('alter table public.%I enable trigger user', v_tbl);
    v_touched := v_touched || v_tbl;
  end loop;

  -- 9. Put the checks back, with the new words ---------------------------------------------------------------------
  for r in select * from ut_chk loop
    execute format('alter table %s add constraint %I %s', pg_temp.ut_rn(r.tbl), pg_temp.ut_rn(r.conname), pg_temp.ut_rn(r.def));
  end loop;

  -- 10. Prove it ------------------------------------------------------------------------------------------------
  -- 10a. Every table still has every row.
  for r in select b.*, c.relname from ut_before b join pg_class c on c.oid = b.oid loop
    execute format('select count(*) from public.%I', r.relname) into v_n;
    if v_n <> r.n then
      raise exception 'Table % had % rows and now has %', r.relname, r.n, v_n;
    end if;
  end loop;
  -- 10b. A table whose rows were not meant to change is byte for byte the same.
  for r in select b.*, c.relname from ut_before b join pg_class c on c.oid = b.oid loop
    if r.relname = any (v_touched) then continue; end if;
    execute format($q$select coalesce(sum(('x' || substr(md5(t::text), 1, 15))::bit(60)::bigint::numeric), 0) from public.%I t$q$, r.relname) into v_sum;
    if v_sum <> r.chk then
      -- a renamed enum label (the role community_champion) shows in a row's text; those tables differ in that column only
      if not exists (
        select 1 from pg_attribute at join pg_type ty on ty.oid = at.atttypid
         where at.attrelid = r.oid and at.attnum > 0 and not at.attisdropped and ty.typtype = 'e'
           and exists (select 1 from pg_enum e where e.enumtypid = ty.oid and e.enumlabel = 'community_champion')
      ) then
        raise exception 'Table % changed although the migration was not meant to touch it', r.relname;
      end if;
    end if;
  end loop;
  -- 10c. No old name is left behind.
  select count(*) into v_n from pg_class c where c.relnamespace in ('public'::regnamespace, 'bi'::regnamespace) and c.relname ~* 'circle';
  if v_n > 0 then raise exception 'A relation with "circle" in its name is still there'; end if;
  select count(*) into v_n from pg_attribute at join pg_class c on c.oid = at.attrelid
   where c.relnamespace in ('public'::regnamespace, 'bi'::regnamespace) and c.relkind in ('r', 'p', 'm', 'v') and at.attnum > 0 and not at.attisdropped and at.attname ~* 'circle';
  if v_n > 0 then raise exception 'A column with "circle" in its name is still there'; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and (p.proname ~* 'circle' or (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) ~* 'circle');
  if v_n > 0 then raise exception 'A function that still says "circle" is still there'; end if;
  select count(*) into v_n from pg_type t where t.typnamespace = 'public'::regnamespace and (t.typname ~* 'circle');
  if v_n > 0 then raise exception 'A type with "circle" in its name is still there'; end if;
  -- 10d. Names fit Postgres's 63-character limit (it would otherwise shorten them silently).
  select count(*) into v_n from pg_class c where c.relnamespace in ('public'::regnamespace, 'bi'::regnamespace) and length(c.relname) > 63;
  if v_n > 0 then raise exception 'A name is too long'; end if;
end
$migration$;

-- Tell the API (PostgREST) to read the new names straight away.
notify pgrst, 'reload schema';

reset statement_timeout;
reset lock_timeout;
