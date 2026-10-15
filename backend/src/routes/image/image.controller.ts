import { Controller, Get, Head, Logger, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
    ImageMetaResponse,
    ImageRequestParams,
} from 'picsur-shared/dist/dto/api/image.dto';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import {
    FT,
    IsFailure,
    ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../collections/user-db/user-db.service.js';
import { EasyThrottle } from '../../decorators/easy-throttle.decorator.js';
import { ImageFullIdParam } from '../../decorators/image-id/image-full-id.decorator.js';
import { ImageIdParam } from '../../decorators/image-id/image-id.decorator.js';
import { RequiredPermissions } from '../../decorators/permissions.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { ImageManagerService } from '../../managers/image/image.service.js';
import type { ImageFullId } from '../../models/constants/image-full-id.const.js';
import { Permission } from '../../models/constants/permissions.const.js';
import { EUserBackend2EUser } from '../../models/transformers/user.transformer.js';
import { BrandMessageType, GetBrandMessage } from '../../util/branding.js';

// SVG is an active document format: it can carry scripts and load remote
// resources. Sans this, a browser that opens /i/<id>.svg directly would render
// it in this origin. The payload is already sanitized on upload; these headers
// are the second layer for anything that slips through.
const SvgContentSecurityPolicy = [
  'sandbox',
  "default-src 'none'",
  "base-uri 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
].join('; ');

// Request budget for the public image routes. They used to be `@SkipThrottle()`
// (= unlimited) while every request can spawn a sharp worker and store a new
// derivative, so one anonymous caller could drive unbounded CPU and database
// growth (audit A-8). The limit is deliberately loose: a gallery page pulls
// dozens of thumbnails at once, and clients behind one NAT share a bucket.
const ImageRequestsPerMinute = 600;

// This is the only controller with CORS enabled
@Controller('i')
@RequiredPermissions(Permission.ImageView)
@EasyThrottle(ImageRequestsPerMinute, 60)
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(
    private readonly imagesService: ImageManagerService,
    private readonly userService: UserDbService,
  ) {}

  @Head(':id')
  async headImage(
    @Res({ passthrough: true }) res: FastifyReply,
    @ImageFullIdParam() fullid: ImageFullId,
  ) {
    try {
      if (fullid.variant === ImageEntryVariant.ORIGINAL) {
        const filetype = ThrowIfFailed(
          await this.getOriginalDownloadFileType(fullid.id),
        );

        this.setImageResponseHeaders(res, filetype.identifier);
        res.type(ThrowIfFailed(FileType2Mime(filetype.identifier)));
        return;
      }

      // The requested filetype is already known from the URL, so existence has
      // to be checked separately: HEAD is the probe used by the image
      // component, and a deleted image must not answer 200 (see `getImage`).
      ThrowIfFailed(await this.imagesService.getMasterFileType(fullid.id));

      this.setImageResponseHeaders(res, fullid.filetype);
      res.type(ThrowIfFailed(FileType2Mime(fullid.filetype)));
    } catch (e) {
      // Clients use HEAD to probe whether an image still exists, so a missing
      // image must not be reported as 200 (see `getImage`).
      if (!IsFailure(e) || e.getType() !== FT.NotFound) throw e;

      this.setNotFoundHeaders(res);
    }
  }

  @Get(':id')
  async getImage(
    // Usually passthrough is for manually sending the response,
    // But we need it here to set the mime type
    @Res({ passthrough: true }) res: FastifyReply,
    @ImageFullIdParam() fullid: ImageFullId,
    @Query() params: ImageRequestParams,
  ): Promise<Buffer> {
    try {
      if (fullid.variant === ImageEntryVariant.ORIGINAL) {
        const image = ThrowIfFailed(
          await this.getOriginalDownload(fullid.id),
        );

        this.setImageResponseHeaders(res, image.filetype);
        res.type(ThrowIfFailed(FileType2Mime(image.filetype)));
        return image.data;
      }

      const image = ThrowIfFailed(
        await this.imagesService.getConverted(
          fullid.id,
          fullid.filetype,
          params,
        ),
      );

      this.setImageResponseHeaders(res, image.filetype);
      res.type(ThrowIfFailed(FileType2Mime(image.filetype)));
      return image.data;
    } catch (e) {
      if (!IsFailure(e) || e.getType() !== FT.NotFound) throw e;

      // A deleted (or never existing) image is a 404. The branded placeholder
      // is still returned as the body, so hotlinked links keep showing
      // something recognisable, but it must never be cached: with a 30 day
      // cache the browser would keep serving it for an id that is gone.
      this.setNotFoundHeaders(res);

      const message = ThrowIfFailed(
        await GetBrandMessage(BrandMessageType.NotFound),
      );
      res.type(message.type);
      return message.data;
    }
  }

  /**
   * Mark a missing image as 404 + no-store.
   *
   * The image cache middleware (`AppModule.imageCacheSet`) sets a month long
   * `Cache-Control` on every `/i/*` response, so it has to be overridden here.
   * Images that do exist keep that cache header untouched.
   */
  private setNotFoundHeaders(res: FastifyReply) {
    res.status(404);
    res.header('Cache-Control', 'no-store');
  }

  @Get('meta/:id')
  @Returns(ImageMetaResponse)
  async getImageMeta(
    @Res({ passthrough: true }) res: FastifyReply,
    @ImageIdParam() id: string,
  ): Promise<ImageMetaResponse> {
    // Metadata must not be cached: the frontend uses it to decide whether an
    // image still exists, so a cached 200 would keep rendering a deleted
    // image's page (with working looking links) for up to a month. The image
    // bytes themselves keep their long cache, only this JSON is exempt.
    res.header('Cache-Control', 'no-store');

    const image = ThrowIfFailed(await this.imagesService.findOne(id));

    const [fileMimesRes, imageUserRes] = await Promise.all([
      this.imagesService.getFileMimes(id),
      this.userService.findOne(image.user_id),
    ]);

    const fileTypes = ThrowIfFailed(fileMimesRes);
    const imageUser = ThrowIfFailed(imageUserRes);

    return { image, user: EUserBackend2EUser(imageUser), fileTypes };
  }

  private setImageResponseHeaders(res: FastifyReply, filetype: string) {
    if (filetype !== ImageFileType.SVG) return;

    res.header('Content-Security-Policy', SvgContentSecurityPolicy);
    res.header('X-Content-Type-Options', 'nosniff');
  }

  /**
   * Serves the uploaded original when it was kept, and falls back to the master
   * file for SVG: SVG is stored as the master itself, and the "keep original"
   * preference is off by default, so without this fallback every `/i/<id>` on
   * an SVG upload would return the not-found placeholder.
   */
  private async getOriginalDownload(imageId: string) {
    const original = await this.imagesService.getOriginal(imageId);
    if (!IsFailure(original) || original.getType() !== FT.NotFound) {
      return original;
    }

    const master = await this.imagesService.getMasterFile(imageId);
    if (IsFailure(master)) return master;

    if (master.filetype !== ImageFileType.SVG) return original;

    return master;
  }

  private async getOriginalDownloadFileType(imageId: string) {
    const original = await this.imagesService.getOriginalFileType(imageId);
    if (!IsFailure(original) || original.getType() !== FT.NotFound) {
      return original;
    }

    const master = await this.imagesService.getMasterFileType(imageId);
    if (IsFailure(master)) return master;

    if (master.identifier !== ImageFileType.SVG) return original;

    return master;
  }
}
