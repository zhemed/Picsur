import { Pipe, PipeTransform } from '@angular/core';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { I18nService } from '../i18n/i18n.service';
import { UIPermissionTranslationKeys } from '../i18n/permissions.i18n';

/**
 * Renders a permission as its translated label.
 *
 * Permissions the UI does not know about (a newer server, or a leftover value
 * from an older one) fall back to the raw string instead of showing nothing.
 */
@Pipe({
  standalone: false,
  name: 'permissionLabel',
})
export class PermissionLabelPipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(permission: string): string {
    const key = UIPermissionTranslationKeys[permission as Permission];
    if (!key) return permission;

    return this.i18n.instant(key);
  }
}
