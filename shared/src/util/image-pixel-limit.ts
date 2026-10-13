// Sharp refuses to process images whose pixel count exceeds `limitInputPixels`
// (default 268402689 = 0x3FFF * 0x3FFF). That rejection used to surface as an
// opaque 500 ("Worker closed"), see issue #107.
//
// This module is dependency free (it is part of picsur-shared) and only holds
// the contract between the main process and the sharp worker: how the limit is
// read from the environment, how an oversized image is described to the user,
// and how that description survives the process boundary.

import { ParseInt } from './parse-simple.js';

/** Sharp's own default: 0x3FFF * 0x3FFF */
export const DefaultMaxImagePixels = 0x3fff * 0x3fff;

/** Environment variable that raises (or disables) the pixel limit. */
export const MaxImagePixelsEnv = 'PICSUR_MAX_IMAGE_PIXELS';

/**
 * Marker prefix that carries a pixel limit failure across the worker boundary.
 * A plain string survives that boundary, a `Failure` instance does not.
 */
export const PixelLimitFailureMarker = 'image-pixel-limit-exceeded: ';

/**
 * Parse a configured pixel limit. Missing/unparsable values fall back to the
 * default, `0` (and anything else non positive) disables the limit.
 */
export function ReadMaxImagePixels(value: unknown): number {
  const parsed = ParseInt(value, DefaultMaxImagePixels);

  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  return parsed;
}

export function ReadMaxImagePixelsFromEnv(): number {
  return ReadMaxImagePixels(process.env[MaxImagePixelsEnv]);
}

/**
 * `true` when the image is within the limit. A limit of `0` disables the check,
 * and unknown dimensions (formats that cannot be sniffed from the header) are
 * let through so the worker can still attempt them.
 */
export function IsWithinPixelLimit(
  maxPixels: number,
  width?: number,
  height?: number,
): boolean {
  if (maxPixels <= 0) return true;
  if (width === undefined || height === undefined) return true;

  return width * height <= maxPixels;
}

/** The message a user sees when an image exceeds the pixel limit. */
export function BuildPixelLimitMessage(
  maxPixels: number,
  width?: number,
  height?: number,
): string {
  const limit =
    maxPixels > 0
      ? `the maximum of ${maxPixels} pixels`
      : 'the configured limit';
  const hint = `Set ${MaxImagePixelsEnv} to raise the limit (0 disables it).`;

  if (width !== undefined && height !== undefined) {
    return `Image is too large to process: ${width}x${height} (${
      width * height
    } pixels) exceeds ${limit}. ${hint}`;
  }

  return `Image is too large to process: it exceeds ${limit}. ${hint}`;
}

/**
 * The same message, prefixed with the marker that carries it across the worker
 * boundary. Strip the marker with `DecodeWorkerFailure` before showing it to a
 * user; the main process shows `BuildPixelLimitMessage` directly.
 */
export function EncodePixelLimitFailure(
  maxPixels: number,
  width?: number,
  height?: number,
): string {
  return (
    PixelLimitFailureMarker + BuildPixelLimitMessage(maxPixels, width, height)
  );
}

/**
 * Marker for a corrupt/unreadable image, so the worker can report it as a user
 * error (4xx) instead of the opaque "Worker closed" 500.
 */
export const DecodeFailureMarker = 'image-decode-failed: ';

export function DecodeFailureReason(debug: string): string {
  return `${DecodeFailureMarker}Failed to decode the image: it appears to be corrupt or unsupported (${debug})`;
}

/**
 * Substrings libvips/sharp use when they refuse an input for its pixel count.
 * Used by the worker to translate a native error into the readable message.
 */
export const PixelLimitFailureHints = [
  'exceeds pixel limit',
  'Input image exceeds pixel limit',
];

export function IsPixelLimitError(message: string): boolean {
  return PixelLimitFailureHints.some((hint) => message.includes(hint));
}

/**
 * Decode a worker failure reason into the user visible message.
 * `undefined` when the worker reported something this layer does not know.
 */
export function DecodeWorkerFailure(encoded: string): string | undefined {
  if (encoded.startsWith(PixelLimitFailureMarker)) {
    return encoded.slice(PixelLimitFailureMarker.length);
  }

  if (encoded.startsWith(DecodeFailureMarker)) {
    return encoded.slice(DecodeFailureMarker.length);
  }

  return undefined;
}
