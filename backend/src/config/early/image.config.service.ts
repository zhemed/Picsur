import { Injectable, Logger } from '@nestjs/common';
import {
    DefaultMaxImagePixels,
    MaxImagePixelsEnv,
    ReadMaxImagePixelsFromEnv,
} from 'picsur-shared/dist/util/image-pixel-limit';

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

  constructor() {
    this.maxImagePixels = ReadMaxImagePixelsFromEnv();

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
  }

  /** `0` means "no limit". */
  public getMaxImagePixels(): number {
    return this.maxImagePixels;
  }
}
