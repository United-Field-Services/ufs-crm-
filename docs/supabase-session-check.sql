-- REVIEWED TEMPLATE ONLY. Not applied by preparing this file.
-- Target: HR platform, ycswaipyuonxwyalkits, and no other Supabase project.
-- Requires explicit approval before installation: this introduces privileged
-- database code and an authenticated-only, boolean, read-only RPC endpoint.
-- No HR records are copied. No Auth rows, accounts, credentials, or keys change.
-- Run as the project's postgres role through the approved migration mechanism.
-- Keep ufs_private OUT of the PostgREST exposed schemas and extra search path.
-- public must remain exposed for the SECURITY INVOKER wrapper below.
--
-- Call public.ufs_session_is_active() with the caller's Supabase access JWT and
-- the project's publishable key. Accept ONLY the literal JSON boolean true.
-- Any missing RPC, error, timeout, null, or false MUST deny access.
-- This does not replace JWT signature/issuer/audience/expiry validation,
-- getUser(), immutable issuer+subject identity binding, or current D1 RBAC.
-- Application admin/hr_manager access must additionally require JWT aal2.
--
-- Supabase project metadata was inspected read-only on 2026-10-11: the columns
-- referenced below exist. No session records, passwords, or secrets were read.
-- refreshed_at is timestamp WITHOUT time zone and Auth writes UTC into it.
-- A never-refreshed session uses created_at, matching Auth.LastRefreshedAt().
-- These explicit 12-hour/30-minute limits apply even on the free plan and do
-- not rely on asynchronous cleanup or dashboard session-timeout enforcement.
-- A 15-minute access token lifetime with refresh shortly before expiry fits
-- the 30-minute refresh-inactivity limit. D1 also enforces actual app inactivity.
--
-- References:
-- https://supabase.com/docs/guides/auth/sessions
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/auth/auth-mfa
-- https://github.com/supabase/auth/blob/master/internal/models/sessions.go

BEGIN;

CREATE SCHEMA IF NOT EXISTS ufs_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA ufs_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA ufs_private TO authenticated;

CREATE OR REPLACE FUNCTION ufs_private.ufs_session_is_active()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_claims jsonb := auth.jwt();
  caller_user_id uuid;
  caller_session_id uuid;
  caller_aal text;
  current_time_utc timestamptz := pg_catalog.statement_timestamp();
BEGIN
  -- No caller-supplied parameters. Only the JWT verified by PostgREST supplies
  -- identity. Ordinary clients cannot set request.jwt.claims through the API.
  IF caller_claims IS NULL
    OR (caller_claims ->> 'iss') IS DISTINCT FROM
       'https://ycswaipyuonxwyalkits.supabase.co/auth/v1'
    OR (caller_claims ->> 'role') IS DISTINCT FROM 'authenticated'
    OR NOT COALESCE(
      (caller_claims -> 'aud') = '"authenticated"'::jsonb
      OR (caller_claims -> 'aud') = '["authenticated"]'::jsonb,
      false
    )
    OR COALESCE(caller_claims ->> 'is_anonymous', 'false') <> 'false'
    OR COALESCE(caller_claims ->> 'sub', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR COALESCE(caller_claims ->> 'session_id', '') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR COALESCE(caller_claims ->> 'exp', '') !~ '^[0-9]{1,12}$'
  THEN
    RETURN false;
  END IF;

  caller_user_id := (caller_claims ->> 'sub')::uuid;
  caller_session_id := (caller_claims ->> 'session_id')::uuid;
  caller_aal := caller_claims ->> 'aal';

  IF caller_user_id IS DISTINCT FROM auth.uid()
    OR caller_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR caller_session_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR caller_aal IS NULL
    OR caller_aal NOT IN ('aal1', 'aal2')
    OR (caller_claims ->> 'exp')::bigint <=
       EXTRACT(EPOCH FROM current_time_utc)
  THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.sessions AS session_record
    JOIN auth.users AS user_record ON user_record.id = session_record.user_id
    WHERE session_record.id = caller_session_id
      AND session_record.user_id = caller_user_id
      AND user_record.deleted_at IS NULL
      AND (user_record.banned_until IS NULL
           OR user_record.banned_until <= current_time_utc)
      AND user_record.is_anonymous IS NOT TRUE
      AND user_record.email_confirmed_at IS NOT NULL
      AND (session_record.not_after IS NULL
           OR session_record.not_after > current_time_utc)
      AND session_record.created_at > current_time_utc - INTERVAL '12 hours'
      AND COALESCE(session_record.refreshed_at AT TIME ZONE 'UTC',
                   session_record.created_at) >
          current_time_utc - INTERVAL '30 minutes'
      -- An old aal2 JWT must not retain its assurance after a live downgrade
      -- or removal of every verified factor. aal1 remains usable only for the
      -- app's bounded sign-in/MFA flow and roles whose policy permits aal1.
      AND (
        caller_aal = 'aal1'
        OR (
          session_record.aal::text = 'aal2'
          AND EXISTS (
            SELECT 1
            FROM auth.mfa_factors AS factor_record
            WHERE factor_record.user_id = caller_user_id
              AND factor_record.status::text = 'verified'
          )
        )
      )
  );
END;
$function$;

ALTER FUNCTION ufs_private.ufs_session_is_active() OWNER TO postgres;
REVOKE ALL ON FUNCTION ufs_private.ufs_session_is_active()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ufs_private.ufs_session_is_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.ufs_session_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT ufs_private.ufs_session_is_active();
$function$;

ALTER FUNCTION public.ufs_session_is_active() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ufs_session_is_active()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ufs_session_is_active() TO authenticated;

COMMENT ON FUNCTION public.ufs_session_is_active() IS
  'UFS People: boolean check of only the authenticated caller session; fail closed; no HR data.';

COMMIT;

-- After APPROVED installation, verify without reading user rows:
-- 1. Inspect pg_proc: private helper prosecdef=true, public wrapper=false,
--    pronargs=0, prorettype=boolean, both search_path empty.
-- 2. has_function_privilege('anon', ..., 'EXECUTE') must be false for both;
--    authenticated must be true; service_role must be false.
-- 3. Check public role ACL entries are absent (PUBLIC is not a role name for
--    has_function_privilege). Confirm ufs_private is not an exposed API schema.
-- 4. Run Supabase security advisors; investigate any new findings.
-- 5. Exercise the REAL API, with a separately authorized owner-created test
--    account: live mapped confirmed session=true; anonymous request denied;
--    revoked session=false; expired JWT denied; unmapped identity denied by D1;
--    aal1 admin denied by app; validated aal2 admin allowed by app.
-- 6. Use non-production/local fixtures to exercise elapsed 12h/30m bounds,
--    wrong session/user pairing, not_after, banned/deleted users, and MFA
--    removal. Never change real Auth rows merely to manufacture test states.
--
-- This is a point-in-time revocation check. A D1 write cannot be in the same
-- transaction as this Supabase check; an operation already authorized/in flight
-- may finish if revocation races it. Do not promise cross-database atomicity.
