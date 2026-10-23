-- The one function the app uses to talk to the database over Supabase's HTTPS API (no database password needed).
-- It runs a list of statements as ONE transaction (all succeed or none do), like the batches the app was written for,
-- and it answers like SQLite did so the application code does not change:
--   * changes() reports how many rows the previous INSERT/UPDATE/DELETE touched
--   * values are placed in the SQL as safely quoted literals (never as raw text)
--   * database errors are reworded in the familiar form ("UNIQUE constraint failed: employees.email")
-- Only the service role can call it. Anon and signed-in users are refused by the database itself.

create schema if not exists ufs;

create or replace function ufs.changes() returns bigint
language sql stable as $$ select coalesce(nullif(current_setting('ufs.changes', true), ''), '0')::bigint $$;

create or replace function public.ufs_batch(statements jsonb) returns jsonb
language plpgsql security definer set search_path = ufs, public, pg_temp as $$
declare
  stmt jsonb;
  q text;
  params jsonb;
  pieces text[];
  marks text[];
  built text;
  k int;
  idx int;
  value jsonb;
  literal text;
  rec record;
  rows jsonb;
  affected bigint;
  results jsonb := '[]'::jsonb;
  column_list text;
  err_table text;
  err_detail text;
begin
  if jsonb_typeof(statements) <> 'array' or jsonb_array_length(statements) > 200 then
    raise exception 'Invalid batch';
  end if;
  perform set_config('ufs.changes', '0', true);
  for stmt in select * from jsonb_array_elements(statements) loop
    q := stmt->>'sql';
    params := coalesce(stmt->'params', '[]'::jsonb);
    if q is null or length(q) > 100000 then raise exception 'Invalid statement'; end if;

    -- Place the values in one pass (so a value that happens to contain "$1" is never expanded again).
    pieces := regexp_split_to_array(q, '\$[0-9]+');
    select coalesce(array_agg(m[1] order by ord), '{}') into marks from regexp_matches(q, '\$([0-9]+)', 'g') with ordinality as t(m, ord);
    built := pieces[1];
    for k in 1 .. coalesce(array_length(marks, 1), 0) loop
      idx := marks[k]::int;
      if idx < 1 or idx > jsonb_array_length(params) then raise exception 'Missing value for $%', idx; end if;
      value := params -> (idx - 1);
      literal := case jsonb_typeof(value)
        when 'null' then 'NULL'
        -- A JSON number is always plain digits; the brackets keep a negative value from joining the text before it ("a-" + "-5" is not a comment).
        when 'number' then '(' || (value #>> '{}') || ')'
        when 'boolean' then case when (value #>> '{}')::boolean then '1' else '0' end
        when 'string' then quote_literal(value #>> '{}')
        else null end;
      if literal is null then raise exception 'Unsupported value type'; end if;
      built := built || literal || coalesce(pieces[k + 1], '');
    end loop;

    if upper(left(ltrim(built), 6)) = 'SELECT' or upper(left(ltrim(built), 4)) = 'WITH' then
      rows := '[]'::jsonb;
      for rec in execute built loop
        rows := rows || jsonb_build_array(to_jsonb(rec));
      end loop;
      results := results || jsonb_build_array(jsonb_build_object('rows', rows, 'changes', 0));
    else
      execute built;
      get diagnostics affected = row_count;
      perform set_config('ufs.changes', affected::text, true);
      results := results || jsonb_build_array(jsonb_build_object('rows', '[]'::jsonb, 'changes', affected));
    end if;
  end loop;
  return results;
exception
  when unique_violation then
    get stacked diagnostics err_table = table_name, err_detail = pg_exception_detail;
    select string_agg(err_table || '.' || trim(c), ', ') into column_list
      from unnest(string_to_array(substring(err_detail from '\(([^)]*)\)='), ',')) as c;
    raise exception 'UNIQUE constraint failed: %', coalesce(column_list, err_table) using errcode = '23505';
  when foreign_key_violation then
    raise exception 'FOREIGN KEY constraint failed' using errcode = '23503';
  when not_null_violation then
    get stacked diagnostics err_table = table_name;
    raise exception 'NOT NULL constraint failed: %', err_table using errcode = '23502';
end $$;

revoke all on function public.ufs_batch(jsonb) from public, anon, authenticated;
grant execute on function public.ufs_batch(jsonb) to service_role;
