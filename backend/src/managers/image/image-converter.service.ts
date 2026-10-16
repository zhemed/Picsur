import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { ImageRequestParams } from 'picsur-shared/dist/dto/api/image.dto';
import {
  FileType,
  ImageFileType,
  SupportedFileTypeCategory,
} from 'picsur-shared/dist/dto/mimes.dto';
import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import {
  BuildPixelLimitMessage,
  IsWithinPixelLimit,
} from 'picsur-shared/dist/util/image-pixel-limit';
import sharp, { SharpOptions } from 'sharp';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';
import { ImageConfigService } from '../../config/early/image.config.service.js';
import { SharpWrapper } from '../../workers/sharp.wrapper.js';
import { ImageResult } from './imageresult.js';

interface InternalConvertOptions {
  lossless?: boolean;
  effort?: number;
}

export type ConvertOptions = ImageRequestParams & InternalConvertOptions;

@Injectable()
export class ImageConverterService {
  constructor(
    private readonly sysPref: SysPreferenceDbService,
    private readonly imageConfig: ImageConfigService,
  ) {}

  public async convert(
    image: Buffer,
    sourceFiletype: FileType,
    targetFiletype: FileType,
    options: ConvertOptions,
  ): AsyncFailable<ImageResult> {
    if (
      sourceFiletype.identifier === targetFiletype.identifier &&
      Object.keys(options).length === 0
    ) {
      return {
        filetype: targetFiletype.identifier,
        image,
      };
    }

    if (
      targetFiletype.category === SupportedFileTypeCategory.Image ||
      targetFiletype.category === SupportedFileTypeCategory.Animation
    ) {
      return this.convertImage(image, sourceFiletype, targetFiletype, options);
      //return this.convertAnimation(image, targetmime, options);
    } else {
      return Fail(FT.SysValidation, 'Unsupported mime type');
    }
  }

  private async convertImage(
    image: Buffer,
    sourceFiletype: FileType,
    targetFiletype: FileType,
    options: ConvertOptions,
  ): AsyncFailable<ImageResult> {
    const [memLimit, timeLimit] = await Promise.all([
      this.sysPref.getNumberPreference(SysPreference.ConversionMemoryLimit),
      this.sysPref.getStringPreference(SysPreference.ConversionTimeLimit),
    ]);
    if (HasFailed(memLimit) || HasFailed(timeLimit)) {
      return Fail(FT.Internal, 'Failed to get conversion limits');
    }
    let timeLimitMS = ms(timeLimit as string);
    if (isNaN(timeLimitMS) || timeLimitMS === 0) timeLimitMS = 15 * 1000; // 15 seconds

    const maxPixels = this.imageConfig.getMaxImagePixels();
    const sharpWrapper = new SharpWrapper(timeLimitMS, memLimit);
    const sharpOptions: SharpOptions = {
      animated: targetFiletype.category === SupportedFileTypeCategory.Animation,
      // Issue #107: make the worker enforce the same limit as the pre-check
      // below, so inputs that cannot be sniffed early (BMP/QOI, which are
      // decoded to raw pixels first) still fail with a readable message
      // instead of an opaque 500.
      limitInputPixels: maxPixels > 0 ? maxPixels : false,
    };

    // Issue #107: reject oversized input before a worker is spawned, and report
    // the limit instead of letting sharp die with a generic 500.
    const pixelLimit = await this.checkPixelLimit(
      image,
      sourceFiletype,
      maxPixels,
    );
    if (HasFailed(pixelLimit)) return pixelLimit;

    const hasStarted = await sharpWrapper.start(
      image,
      sourceFiletype,
      sharpOptions,
    );
    if (HasFailed(hasStarted)) return hasStarted;

    // Do modifications
    if (options.height || options.width) {
      if (options.height && options.width) {
        sharpWrapper.operation('resize', {
          width: options.width,
          height: options.height,
          fit: 'fill',
          kernel: 'cubic',
          withoutEnlargement: options.shrinkonly,
        });
      } else {
        sharpWrapper.operation('resize', {
          width: options.width,
          height: options.height,
          fit: 'inside',
          kernel: 'cubic',

          withoutEnlargement: options.shrinkonly,
        });
      }
    }
    if (options.rotate) {
      sharpWrapper.operation('rotate', options.rotate, {
        background: 'transparent',
      });
    }
    if (options.flipx) {
      sharpWrapper.operation('flop');
    }
    if (options.flipy) {
      sharpWrapper.operation('flip');
    }
    if (options.noalpha) {
      sharpWrapper.operation('removeAlpha');
    }
    if (options.negative) {
      sharpWrapper.operation('negate');
    }
    if (options.greyscale) {
      sharpWrapper.operation('greyscale');
    }

    // Export
    const result = await sharpWrapper.finish(targetFiletype, options);
    if (HasFailed(result)) return result;

    return {
      image: result.data,
      filetype: targetFiletype.identifier,
      // The worker already reports the output size, so the caller can store the
      // dimensions of what it just produced without decoding anything again.
      width: result.info.width,
      height: result.info.height,
    };
  }

  /**
   * Refuse images that exceed the configured pixel limit.
   *
   * Sharp enforces `limitInputPixels` itself, but that rejection happens inside
   * the conversion worker (which then dies and returns an opaque "Worker
   * closed" 500). Reading the header here is cheap, keeps the worker from being
   * spawned for input it cannot handle, and lets the message name the limit.
   */
  private async checkPixelLimit(
    image: Buffer,
    filetype: FileType,
    maxPixels: number,
  ): Promise<AsyncFailable<true>> {
    if (maxPixels <= 0) return true;

    if (
      filetype.identifier === ImageFileType.BMP ||
      filetype.identifier === ImageFileType.QOI
    ) {
      // Raw formats have no header sharp can read; the worker enforces the
      // limit on the decoded pixel buffer instead.
      return true;
    }

    let width: number | undefined;
    let height: number | undefined;
    try {
      // Read the dimensions even when the image itself exceeds the limit, so
      // the rejection can name the actual size.
      const metadata = await sharp(image, {
        limitInputPixels: false,
      }).metadata();

      width = metadata.width;
      height = metadata.height;
    } catch (e) {
      // The image cannot be read at all (corrupt, or a format this libvips
      // build has no decoder for - JXL/JP2 on the prebuilt sharp). Surfacing
      // the underlying reason makes that deploy-time difference visible.
      const reason = e instanceof Error ? e.message : String(e);
      return Fail(
        FT.UsrValidation,
        `Failed to read image metadata: ${reason}`,
      );
    }

    if (!IsWithinPixelLimit(maxPixels, width, height)) {
      // Plain message: the marker that carries failures across the worker
      // boundary must never leak into what the client sees.
      return Fail(
        FT.UsrValidation,
        BuildPixelLimitMessage(maxPixels, width, height),
      );
    }

    return true;
  }
}
