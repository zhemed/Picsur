import { Controller, Get, Head, Logger, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import {
    ImageMetaResponse,
    ImageRequestParams,
} from 'picsur-shared/dist/dto/api/image.dto';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime } from 'picsur-shared/dist/dto/mimes.dto';
import {
    FT,
    IsFailure,
    ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../collections/user-db/user-db.service.js';
import { ImageFullIdParam } from '../../decorators/image-id/image-full-id.decorator.js';
import { ImageIdParam } from '../../decorators/image-id/image-id.decorator.js';
import { RequiredPermissions } from '../../decorators/permissions.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { ImageManagerService } from '../../managers/image/image.service.js';
import type { ImageFullId } from '../../models/constants/image-full-id.const.js';
import { Permission } from '../../models/constants/permissions.const.js';
import { EUserBackend2EUser } from '../../models/transformers/user.transformer.js';
import { BrandMessageType, GetBrandMessage } from '../../util/branding.js';

// This is the only controller with CORS enabled
@Controller('i')
@RequiredPermissions(Permission.ImageView)
@SkipThrottle()
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
          await this.imagesService.getOriginalFileType(fullid.id),
        );

        res.type(ThrowIfFailed(FileType2Mime(filetype.identifier)));
        return;
      }

      // The requested filetype is already known from the URL, so existence has
      // to be checked separately: HEAD is the probe used by the image
      // component, and a deleted image must not answer 200 (see `getImage`).
      ThrowIfFailed(await this.imagesService.getMasterFileType(fullid.id));

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
          await this.imagesService.getOriginal(fullid.id),
        );

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
}
