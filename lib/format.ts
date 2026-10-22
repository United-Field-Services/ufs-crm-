// One date style everywhere: "Nov 5, 2026" (and "Mar 2026" for a month).
export const formatDate = (value?: string | null) =>
  value ? new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const formatMonth = (value: string) =>
  new Date(value.slice(0, 7) + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
