// Every section of the workspace has its own address so it can be reloaded, bookmarked and shared.
export const SECTION_PATHS: Record<string, string> = {
  Overview: '/',
  People: '/people',
  'My profile': '/my-profile',
  Files: '/files',
  Calendar: '/calendar',
  'Time off': '/time-off',
  'Time tracking': '/time-tracking',
  'Org chart': '/org-chart',
  Reports: '/reports',
  'Company news': '/company-news',
  Tasks: '/tasks',
  Workflows: '/workflows',
  Assets: '/assets',
  Settings: '/settings',
};

export const sectionPath = (section: string) => SECTION_PATHS[section] ?? '/';

export function sectionForPath(pathname: string) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return Object.keys(SECTION_PATHS).find((name) => SECTION_PATHS[name] === clean) ?? null;
}
