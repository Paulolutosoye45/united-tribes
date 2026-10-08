-- United Tribes, Phase 0: reference data.
--
-- The shared vocabulary from the blueprint: life-stage tracks, age ranges,
-- tribes, goal families and the starter Season Goals. The app needs these in
-- production, so they live in a migration (not in seed.sql).
--
-- Every insert is idempotent. After launch the office edits these rows from
-- the Admin area (Phase 1); this file only fills in what is missing.

-- ---------------------------------------------------------------------------
-- Life-stage tracks
-- ---------------------------------------------------------------------------

insert into public.tracks (slug, name, min_age, max_age, description, sort, active) values
  ('teens',    'Teens',    13, 17,   'Young people finding their footing in faith and friendship. Opens with guardian consent in a later release.', 1, false),
  ('rising',   'Rising',   18, 25,   'Students and first-job adults building who they are becoming.', 2, true),
  ('builders', 'Builders', 26, 40,   'Adults building career, business, marriage and home at the same time.', 3, true),
  ('stewards', 'Stewards', 41, 60,   'Adults carrying established responsibilities and raising the next generation.', 4, true),
  ('sages',    'Sages',    60, null, 'Seasoned believers who mentor, pray and anchor the family.', 5, true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Age ranges (what the member taps; each maps to one track)
-- ---------------------------------------------------------------------------

insert into public.age_ranges (slug, label, min_age, max_age, track_id, sort)
select v.slug, v.label, v.min_age, v.max_age, t.id, v.sort
from (values
  ('13-17', '13–17', 13, 17,   'teens',    1),
  ('18-25', '18–25', 18, 25,   'rising',   2),
  ('26-32', '26–32', 26, 32,   'builders', 3),
  ('33-40', '33–40', 33, 40,   'builders', 4),
  ('41-50', '41–50', 41, 50,   'stewards', 5),
  ('51-60', '51–60', 51, 60,   'stewards', 6),
  ('60-plus', '60+', 60, null, 'sages',    7)
) as v (slug, label, min_age, max_age, track_slug, sort)
join public.tracks t on t.slug = v.track_slug
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Tribes
-- ---------------------------------------------------------------------------

insert into public.tribes (slug, name, description, sort) values
  ('business-entrepreneurship', 'Business & Entrepreneurship', 'People starting, running or growing a business.', 1),
  ('professionals',             'Professionals',               'Employed professionals shaping a career and a calling.', 2),
  ('consulting',                'Consulting',                  'Independent consultants, advisers and freelancers who sell their expertise.', 3),
  ('in-between-jobs',           'In-between Jobs',             'People between roles who want company, structure and a next step.', 4),
  ('global-citizens',           'Global Citizens',             'People living abroad, returning home or holding family together across borders.', 5),
  ('marriage-relationships',    'Marriage & Relationships',    'Married couples, people preparing for marriage and people rebuilding after loss.', 6),
  ('parents-family',            'Parents & Family',            'Parents and carers building a faith-filled home.', 7),
  ('health-fitness-sports',     'Health, Fitness & Sports',    'People building strength, health and discipline together.', 8),
  ('education',                 'Education',                   'Students, teachers and lecturers.', 9),
  ('medical-healthcare',        'Medical & Healthcare',        'Doctors, nurses, pharmacists and health workers.', 10),
  ('creative-economy',          'Creative Economy',            'Musicians, designers, writers, filmmakers and other makers.', 11)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Goal families (let the matching engine find close alternatives)
-- ---------------------------------------------------------------------------

insert into public.goal_families (slug, name, sort) values
  ('enterprise',      'Enterprise',        1),
  ('career-calling',  'Career and calling', 2),
  ('relationships',   'Relationships',     3),
  ('faith-home',      'Faith and home',    4),
  ('health',          'Health',            5),
  ('learning',        'Learning',          6)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Starter Season Goals: one short list per tribe
-- ---------------------------------------------------------------------------

insert into public.season_goals (tribe_id, family_id, slug, title, sort)
select t.id, f.id, v.slug, v.title, v.sort
from (values
  ('business-entrepreneurship', 'enterprise',     'launch-or-formalise-a-business',          'Launch or formalise a business', 1),
  ('business-entrepreneurship', 'enterprise',     'grow-revenue-and-systems',                'Grow revenue and systems', 2),

  ('professionals',             'career-calling', 'step-into-a-leadership-role',             'Step into a leadership role', 1),
  ('professionals',             'career-calling', 'change-career-direction-with-confidence', 'Change career direction with confidence', 2),

  ('consulting',                'enterprise',     'build-a-steady-client-pipeline',          'Build a steady client pipeline', 1),
  ('consulting',                'enterprise',     'price-and-package-my-expertise',          'Price and package my expertise', 2),

  ('in-between-jobs',           'career-calling', 'land-my-next-role',                       'Land my next role', 1),
  ('in-between-jobs',           'career-calling', 'retool-with-new-skills',                  'Retool with new skills', 2),

  ('global-citizens',           'relationships',  'thrive-in-a-long-distance-family',        'Thrive in a long-distance family', 1),
  ('global-citizens',           'relationships',  'make-a-cross-border-move-well',           'Make a cross-border move well', 2),

  ('marriage-relationships',    'relationships',  'strengthen-our-marriage',                 'Strengthen our marriage', 1),
  ('marriage-relationships',    'relationships',  'prepare-well-for-marriage',               'Prepare well for marriage', 2),
  ('marriage-relationships',    'relationships',  'rebuild-after-a-relationship-ends',       'Rebuild after a relationship ends', 3),

  ('parents-family',            'faith-home',     'build-a-faith-filled-home-rhythm',        'Build a faith-filled home rhythm', 1),
  ('parents-family',            'faith-home',     'parent-teenagers-well',                   'Parent teenagers well', 2),

  ('health-fitness-sports',     'health',         'build-a-consistent-fitness-habit',        'Build a consistent fitness habit', 1),
  ('health-fitness-sports',     'health',         'reach-a-health-milestone',                'Reach a health milestone', 2),

  ('education',                 'learning',       'excel-in-my-studies-or-exams',            'Excel in my studies or exams', 1),
  ('education',                 'learning',       'grow-as-an-educator',                     'Grow as an educator', 2),

  ('medical-healthcare',        'career-calling', 'sustain-my-calling-without-burning-out',  'Sustain my calling without burning out', 1),
  ('medical-healthcare',        'career-calling', 'advance-my-specialisation',               'Advance my specialisation', 2),

  ('creative-economy',          'enterprise',     'finish-and-release-a-body-of-work',       'Finish and release a body of work', 1),
  ('creative-economy',          'enterprise',     'turn-my-craft-into-income',               'Turn my craft into income', 2)
) as v (tribe_slug, family_slug, slug, title, sort)
join public.tribes t on t.slug = v.tribe_slug
join public.goal_families f on f.slug = v.family_slug
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- A provisional first season so the office has something to edit.
-- Starts on a Sunday; 12 weeks. The office confirms the dates in Phase 1.
-- ---------------------------------------------------------------------------

insert into public.seasons (centre_id, name, starts_on, ends_on, weeks, status)
select c.id, 'Season 1, 2027 (provisional)', date '2027-02-14', date '2027-05-08', 12, 'planning'
from public.centres c
where c.slug = 'tcn-iganmu'
  and not exists (
    select 1 from public.seasons s
    where s.centre_id = c.id and s.starts_on = date '2027-02-14'
  );
