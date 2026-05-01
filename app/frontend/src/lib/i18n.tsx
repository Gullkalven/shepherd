import { createContext, useContext, type ReactNode } from 'react';

type TranslationKey =
  | 'projects'
  | 'sites'
  | 'today'
  | 'site'
  | 'searchProjects'
  | 'searchFloorsAndRooms'
  | 'findSite'
  | 'findRoom'
  | 'searchProjectsAria'
  | 'searchFloorsAndRoomsAria'
  | 'findSiteAria'
  | 'findRoomAria'
  | 'loading'
  | 'loadingFloors'
  | 'project'
  | 'noMatches'
  | 'adminSettings'
  | 'lightMode'
  | 'darkMode'
  | 'logOut'
  | 'dashboard'
  | 'checklist'
  | 'save'
  | 'delete'
  | 'uploadPhoto'
  | 'deadline';

const DICTIONARY: Record<TranslationKey, string> = {
  projects: 'Projects',
  sites: 'Sites',
  today: 'Today',
  site: 'Site',
  searchProjects: 'Search projects...',
  searchFloorsAndRooms: 'Search floors and rooms...',
  findSite: 'Find site...',
  findRoom: 'Find room...',
  searchProjectsAria: 'Search projects',
  searchFloorsAndRoomsAria: 'Search floors and rooms',
  findSiteAria: 'Find site',
  findRoomAria: 'Find room',
  loading: 'Loading...',
  loadingFloors: 'Loading floors...',
  project: 'Project',
  noMatches: 'No matches',
  adminSettings: 'Admin settings',
  lightMode: 'Light mode',
  darkMode: 'Dark mode',
  logOut: 'Log out',
  dashboard: 'Dashboard',
  checklist: 'Checklist',
  save: 'Save',
  delete: 'Delete',
  uploadPhoto: 'Upload photo',
  deadline: 'Deadline',
};

type I18nContextValue = {
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const value: I18nContextValue = { t: (key) => DICTIONARY[key] ?? key };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
