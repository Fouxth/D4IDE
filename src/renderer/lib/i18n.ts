import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import th from '../locales/th.json';
import en from '../locales/en.json';

/**
 * A missing key used to be invisible: i18next silently prints the key itself,
 * so the app shipped screens that read `providers.status.notConfigured`
 * (spec §72). Falling back to English is still the right behaviour — this just
 * reports the miss once, which is enough to catch it during development and in
 * a screenshot review. `tests/locales.test.ts` guards the same thing statically.
 */
const reported = new Set<string>();

const read = (dictionary: unknown, key: string): string | undefined => {
  const value = key
    .split('.')
    .reduce<any>((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dictionary);
  return typeof value === 'string' ? value : undefined;
};

i18n.use(initReactI18next).init({
  resources: {
    th: { translation: th },
    en: { translation: en }
  },
  lng: 'th', // Default to Thai as requested in Section 72 & 72.1
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  },
  parseMissingKeyHandler: (key: string) => {
    const english = read(en, key);
    if (english !== undefined) return english;
    if (!reported.has(key)) {
      reported.add(key);
      console.warn(`[D4IDE] missing translation key: ${key}`);
    }
    return key;
  }
});

export default i18n;
