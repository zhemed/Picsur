import { Pipe, PipeTransform } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Impure on purpose: the language can be changed at runtime, so the pipe has
 * to be re-evaluated on every change detection run.
 *
 * Usage: `{{ 'common.actions.login' | translate }}` or
 *        `{{ 'view.uploadedBy' | translate: { date: date, user: name } }}`
 */
@Pipe({
  standalone: false,
  name: 'translate',
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(
    key: string | null | undefined,
    params?: Record<string, unknown>,
  ): string {
    if (key === null || key === undefined) return '';

    return this.i18n.instant(key, params);
  }
}
