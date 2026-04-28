import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Language = 'no' | 'en';

type TranslationKey =
  | 'language'
  | 'norsk'
  | 'english'
  | 'projects'
  | 'searchProjects'
  | 'searchFloorsAndRooms'
  | 'searchProjectsAria'
  | 'searchFloorsAndRoomsAria'
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

const DEFAULT_LANGUAGE: Language = 'no';
const STORAGE_KEY = 'shepherd-language';

const DICTIONARY: Record<Language, Record<TranslationKey, string>> = {
  no: {
    language: 'Sprak',
    norsk: 'Norsk',
    english: 'English',
    projects: 'Prosjekter',
    searchProjects: 'Sok prosjekter...',
    searchFloorsAndRooms: 'Sok etasjer og rom...',
    searchProjectsAria: 'Sok prosjekter',
    searchFloorsAndRoomsAria: 'Sok etasjer og rom',
    loading: 'Laster...',
    loadingFloors: 'Laster etasjer...',
    project: 'Prosjekt',
    noMatches: 'Ingen treff',
    adminSettings: 'Admininnstillinger',
    lightMode: 'Lys modus',
    darkMode: 'Mork modus',
    logOut: 'Logg ut',
    dashboard: 'Oversikt',
    checklist: 'Sjekkliste',
    save: 'Lagre',
    delete: 'Slett',
    uploadPhoto: 'Last opp bilde',
    deadline: 'Frist',
  },
  en: {
    language: 'Language',
    norsk: 'Norsk',
    english: 'English',
    projects: 'Projects',
    searchProjects: 'Search projects...',
    searchFloorsAndRooms: 'Search floors and rooms...',
    searchProjectsAria: 'Search projects',
    searchFloorsAndRoomsAria: 'Search floors and rooms',
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
  },
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'en' || raw === 'no' ? raw : DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage());

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => DICTIONARY[language][key] ?? DICTIONARY.en[key] ?? key,
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
