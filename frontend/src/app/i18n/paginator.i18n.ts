import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { I18nService } from './i18n.service';

/**
 * Material's `MatPaginator` ships with hardcoded English labels
 * ("Items per page:", "Next page", ...). This subclass routes every one of
 * them through our own `I18nService`, and re-emits `changes` whenever the
 * visitor switches language so an already rendered paginator updates too.
 */
@Injectable()
export class PicsurPaginatorIntl extends MatPaginatorIntl {
  constructor(private readonly i18n: I18nService) {
    super();

    this.applyLabels();

    this.i18n.languageChange
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyLabels());
  }

  private applyLabels() {
    this.itemsPerPageLabel = this.i18n.instant('pagination.itemsPerPage');
    this.nextPageLabel = this.i18n.instant('pagination.nextPage');
    this.previousPageLabel = this.i18n.instant('pagination.previousPage');
    this.firstPageLabel = this.i18n.instant('pagination.firstPage');
    this.lastPageLabel = this.i18n.instant('pagination.lastPage');

    this.getRangeLabel = (page: number, pageSize: number, length: number) => {
      if (length === 0 || pageSize === 0) {
        return this.i18n.instant('pagination.range', {
          start: 0,
          end: 0,
          length,
        });
      }

      const start = page * pageSize + 1;
      const end = Math.min((page + 1) * pageSize, length);

      return this.i18n.instant('pagination.range', { start, end, length });
    };

    this.changes.next();
  }
}
