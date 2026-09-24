-- Smoke test for the baseline migration: the extensions Faff depends on are installed.
-- M2's RLS and append-only tests sit alongside this file.
begin;

-- Test-only: never part of a migration (see migrations/0000_extensions.sql).
create extension if not exists pgtap with schema extensions;

select plan(6);

select has_extension('pgmq', 'pgmq is installed');
select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('pgcrypto', 'pgcrypto is installed');

select has_schema('pgmq', 'pgmq owns its schema');
select has_schema('cron', 'pg_cron owns the cron schema');

-- The migration must not create anything else: no tables until M2.
select is_empty(
  $$ select table_name from information_schema.tables where table_schema = 'public' $$,
  'public has no tables yet'
);

select * from finish();
rollback;
