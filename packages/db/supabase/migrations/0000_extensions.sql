-- Baseline (M0 plan §5, PR 0.2): the extensions later milestones build on, and nothing else.
-- No tables, queues or cron jobs here; tables land in M2, queues and jobs in M4.
--
-- pgtap is deliberately absent: it is test-only, so each file in supabase/tests enables it
-- inside its own rolled-back transaction and it never reaches faff-dev or faff-prod.

-- Queues (D8, P4). pgmq is not relocatable; it creates and owns the `pgmq` schema.
create extension if not exists pgmq;

-- The per-minute sweep that re-enqueues due tasks (P4). Supabase installs pg_cron into
-- pg_catalog; its objects live in the `cron` schema.
create extension if not exists pg_cron with schema pg_catalog;

-- Hashing and random bytes in SQL. Supabase pre-installs it in `extensions` on hosted
-- projects; stating it here makes the dependency explicit and the migration self-contained.
create extension if not exists pgcrypto with schema extensions;
