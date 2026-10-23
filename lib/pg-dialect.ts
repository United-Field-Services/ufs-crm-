// The app's SQL was written for SQLite (Cloudflare D1). This turns each statement into Postgres (Supabase) just before it
// is sent, so the application code does not have to change. It only touches code outside quoted text.
//   ?                      ->  $1, $2 ...
//   INSERT OR IGNORE ...   ->  INSERT ... ON CONFLICT DO NOTHING
//   x IS ?  /  x IS NOT ?  ->  IS NOT DISTINCT FROM  /  IS DISTINCT FROM  (SQLite's null-safe comparison)
//   changes()              ->  ufs.changes()   (rows touched by the previous statement; see supabase/executor.sql)
//   LIKE                   ->  ILIKE           (SQLite's LIKE ignores letter case)
//   MAX(a, b)              ->  GREATEST(a, b)  (SQLite's two-argument MAX)
export function toPostgres(sql: string): string {
  const strings: string[] = [];
  // Hide quoted text so nothing inside it is rewritten.
  let code = sql.replace(/'(?:[^']|'')*'/g, (match) => `\u0000${strings.push(match) - 1}\u0000`);
  const ignore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(code);
  if (/\bINSERT\s+OR\s+REPLACE\b/i.test(code)) throw new Error('INSERT OR REPLACE is not supported');
  code = code
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
    .replace(/\bIS\s+NOT\s+\?/gi, 'IS DISTINCT FROM ?')
    .replace(/\bIS\s+\?/gi, 'IS NOT DISTINCT FROM ?')
    .replace(/\bchanges\(\)/gi, 'ufs.changes()')
    .replace(/\bLIKE\b/gi, 'ILIKE')
    .replace(/\bMAX\(\s*([\w.]+)\s*,\s*([\w.]+)\s*\)/gi, 'GREATEST($1,$2)');
  let position = 0;
  code = code.replace(/\?/g, () => `$${++position}`);
  if (ignore) {
    code = code.replace(/[\s;]+$/, '');
    // "INSERT ... SELECT ... FROM t ON CONFLICT" would read ON as a join condition; a WHERE clause removes the doubt.
    if (/\bSELECT\b/i.test(code) && /\bFROM\b/i.test(code) && !/\bWHERE\b/i.test(code)) code += ' WHERE true';
    code += ' ON CONFLICT DO NOTHING';
  }
  return code.replace(/\u0000(\d+)\u0000/g, (_, index) => strings[Number(index)]);
}
