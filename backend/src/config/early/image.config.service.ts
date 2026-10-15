import { Injectable, Logger } from '@nestjs/common';
import { ParseInt } from 'picsur-shared/dist/util/parse-simple';
import {
    DefaultMaxImagePixels,
    MaxImagePixelsEnv,
    ReadMaxImagePixelsFromEnv,
} from 'picsur-shared/dist/util/image-pixel-limit';

/** Default number of stored derivatives per image. */
export const DefaultMaxDerivativesPerImage = 100;
/** Environment variable that raises (or removes) the derivative cap. */
export const MaxDerivativesPerImageEnv = 'PICSUR_MAX_DERIVATIVES_PER_IMAGE';

/**
 * Pixel budget for image processing.
 *
 * Sharp refuses to decode images above its `limitInputPixels` (default 0x3FFF^2).
 * That limit is the reason an oversized upload used to die with an opaque 500,
 * so it is exposed here and echoed back to the user when it is hit.
 */
@Injectable()
export class ImageConfigService {
  private readonly logger = new Logger(ImageConfigService.name);

  private readonly maxImagePixels: number;
  private readonly maxDerivativesPerImage: number;

  constructor() {
    this.maxImagePixels = ReadMaxImagePixelsFromEnv();
    this.maxDerivativesPerImage = ReadMaxDerivativesPerImage(
      process.env[MaxDerivativesPerImageEnv],
    );

    if (this.maxImagePixels === 0) {
      this.logger.warn(
        `${MaxImagePixelsEnv} disables the pixel limit, oversized images may exhaust memory`,
      );
    } else {
      this.logger.log(
        `Max image pixels: ${this.maxImagePixels}${
          this.maxImagePixels === DefaultMaxImagePixels
            ? ' (sharp default)'
            : ''
        }`,
      );
    }

    this.logger.log(
      `Max derivatives per image: ${
        this.maxDerivativesPerImage === 0
          ? 'unlimited'
          : this.maxDerivativesPerImage
      }`,
    );
  }

  /** `0` means "no limit". */
  public getMaxImagePixels(): number {
    return this.maxImagePixels;
  }

  /**
   * How many cached conversions a single image may have.
   *
   * Every distinct query string (`?width=…`, `?quality=…`, …) is a new cache
   * entry whose bytes live in the database, and the image endpoint is public:
   * without a cap one anonymous caller can grow the table without bound
   * (audit A-8). Beyond the cap the conversion still happens, it is just not
   * stored anymore.
   *
   * `0` means "no limit".
   */
  public getMaxDerivativesPerImage(): number {
    return this.maxDerivativesPerImage;
  }
}

export function ReadMaxDerivativesPerImage(value: unknown): number {
  const parsed = ParseInt(value, DefaultMaxDerivativesPerImage);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}
