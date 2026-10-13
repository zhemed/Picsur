import { Injectable } from '@angular/core';
import * as moment from 'moment';
import 'moment/locale/zh-cn';
import { Observable, Subject } from 'rxjs';
import chineseTranslations from '../../assets/i18n/zh.json';
import englishTranslations from '../../assets/i18n/en.json';

export const availableLanguages = ['en', 'zh'] as const;
export type AvailableLanguage = (typeof availableLanguages)[number];

/**
 * The language used when the visitor has no stored preference yet. Chinese is
 * the primary audience of this instance, so a first visit opens in Chinese.
 */
export const defaultLanguage: AvailableLanguage = 'zh';

type TranslationDictionary = Record<string, unknown>;

const dictionaries: Record<AvailableLanguage, TranslationDictionary> = {
  en: englishTranslations,
  zh: chineseTranslations,
};

/**
 * Dependency free i18n implementation.
 *
 * All translations are bundled with the application (see `src/assets/i18n`),
 * so switching languages never requires a network roundtrip or a page reload.
 * The chosen language is persisted in localStorage and defaults to Chinese
 * (see `defaultLanguage`).
 *
 * The translation keys themselves are strings like `common.actions.login`,
 * they are looked up in the bundled dictionaries by `instant()`.
 */
@Injectable({
  providedIn: 'root',
})
export class I18nService {
  private readonly storageKey = 'picsur.language';
  private readonly fallbackLanguage: AvailableLanguage = defaultLanguage;

  /** Emits the new language code whenever the language changes. */
  private readonly languageSubject = new Subject<AvailableLanguage>();
  public readonly languageChange: Observable<AvailableLanguage> =
    this.languageSubject.asObservable();

  private currentLanguage: AvailableLanguage;

  constructor() {
    this.currentLanguage = this.getInitialLanguage();
    this.applyLanguage(this.currentLanguage);
  }

  /**
   * Translate a key instantly. Keys without a translation are returned
   * unchanged, so this is safe to call on messages that are already meant to
   * be user facing text (e.g. messages coming from the server).
   */
  public instant(key: string, params?: Record<string, unknown>): string {
    const template =
      this.lookup(this.currentLanguage, key) ??
      this.lookup(this.fallbackLanguage, key);

    if (template === null) return key;

    return this.interpolate(template, params);
  }

  /** Change the language and remember the choice for the next visit. */
  public setLanguage(language: AvailableLanguage): void {
    try {
      localStorage.setItem(this.storageKey, language);
    } catch {
      // Storage may be unavailable (private mode), the session still works.
    }

    if (this.currentLanguage === language) return;

    this.currentLanguage = language;
    this.applyLanguage(language);
    this.languageSubject.next(language);
  }

  public getCurrentLanguage(): AvailableLanguage {
    return this.currentLanguage;
  }

  private applyLanguage(language: AvailableLanguage): void {
    // moment is used for the relative timestamps rendered by ngx-moment.
    moment.locale(language === 'zh' ? 'zh-cn' : language);

    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }

  private getInitialLanguage(): AvailableLanguage {
    let storedLanguage: string | null = null;

    try {
      storedLanguage = localStorage.getItem(this.storageKey);
    } catch {
      storedLanguage = null;
    }

    if (storedLanguage === null) return this.fallbackLanguage;

    return this.toAvailableLanguage(storedLanguage);
  }

  private toAvailableLanguage(language: string): AvailableLanguage {
    const langCode = language.split('-')[0]?.toLowerCase();

    if (availableLanguages.includes(langCode as AvailableLanguage)) {
      return langCode as AvailableLanguage;
    }

    return this.fallbackLanguage;
  }

  private lookup(language: AvailableLanguage, key: string): string | null {
    let node: unknown = dictionaries[language];

    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return null;
      node = (node as TranslationDictionary)[part];
    }

    return typeof node === 'string' ? node : null;
  }

  private interpolate(
    template: string,
    params?: Record<string, unknown>,
  ): string {
    if (params === undefined) return template;

    return template.replace(
      /\{\{\s*([^{}\s]+)\s*\}\}/g,
      (match, name: string) => {
        if (!(name in params)) return match;

        const value = params[name];
        return value === null || value === undefined ? '' : String(value);
      },
    );
  }
}
