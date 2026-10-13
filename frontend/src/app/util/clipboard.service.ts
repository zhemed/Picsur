import { Injectable } from '@angular/core';

export enum CopyMethod {
  Clipboard = 'clipboard',
  Legacy = 'legacy',
}

export enum CopyFailure {
  /** No copy mechanism is available in this browser/context. */
  Unsupported = 'unsupported',
  /** The browser refused the copy (usually a permission or focus problem). */
  Denied = 'denied',
}

export type CopyResult =
  | { success: true; method: CopyMethod }
  | { success: false; reason: CopyFailure };

@Injectable({
  providedIn: 'any',
})
export class ClipboardService {
  /**
   * Copy text to the clipboard.
   *
   * `navigator.clipboard` only exists in a secure context (HTTPS or
   * localhost), so a self hosted Picsur behind plain HTTP has no async
   * clipboard at all. In that case fall back to the deprecated but widely
   * available `document.execCommand('copy')` path, which does work on HTTP.
   */
  public async copy(text: string): Promise<CopyResult> {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return { success: true, method: CopyMethod.Clipboard };
      } catch (err) {
        // Fall through to the legacy path
      }
    }

    if (this.copyLegacy(text)) {
      return { success: true, method: CopyMethod.Legacy };
    }

    return { success: false, reason: CopyFailure.Denied };
  }

  /**
   * Selects `text` in a temporary off-screen textarea and copies it with
   * `document.execCommand('copy')`. Works without a secure context.
   */
  private copyLegacy(text: string): boolean {
    if (typeof document === 'undefined') return false;
    if (typeof document.execCommand !== 'function') return false;

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;

      // Keep it out of sight and out of the layout flow
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';

      const active = document.activeElement as HTMLElement | null;
      const selection = document.getSelection();
      const previousRange =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      const copied = document.execCommand('copy');

      document.body.removeChild(textarea);

      if (previousRange && selection) {
        selection.removeAllRanges();
        selection.addRange(previousRange);
      }
      active?.focus();

      return copied;
    } catch (err) {
      return false;
    }
  }
}
