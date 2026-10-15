import {
    Body,
    Controller,
    Get,
    Logger,
    Param,
    Post,
    Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
    ImageDeleteRequest,
    ImageDeleteResponse,
    ImageDeleteWithKeyRequest,
    ImageDeleteWithKeyResponse,
    ImageListAllRequest,
    ImageListAllResponse,
    ImageListRequest,
    ImageListResponse,
    ImageUpdateRequest,
    ImageUpdateResponse,
    ImageUploadResponse,
} from 'picsur-shared/dist/dto/api/image-manage.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import {
    FT,
    Fail,
    HasFailed,
    ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { EasyThrottle } from '../../decorators/easy-throttle.decorator.js';
import { PostFiles } from '../../decorators/multipart/multipart.decorator.js';
import type { FileIterator } from '../../decorators/multipart/postfiles.pipe.js';
import {
    HasPermission,
    RequiredPermissions,
} from '../../decorators/permissions.decorator.js';
import { ReqUserID } from '../../decorators/request-user.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { MultipartConfigService } from '../../config/early/multipart.config.service.js';
import { ImageManagerService } from '../../managers/image/image.service.js';
import { GetNextAsync } from '../../util/iterator.js';
import { MapUploadError } from '../../util/upload-error.js';

// Permissions are declared per handler on purpose: the guard requires the
// *union* of class and handler permissions, so a class level `ImageUpload`
// silently became a requirement for list/update/delete too — revoking upload
// rights also broke "manage my own images" (audit A-4).
@Controller('api/image')
export class ImageManageController {
  private readonly logger = new Logger(ImageManageController.name);

  constructor(
    private readonly imagesService: ImageManagerService,
    private readonly multipartConfig: MultipartConfigService,
  ) {}

  @Post('upload')
  @RequiredPermissions(Permission.ImageUpload)
  @Returns(ImageUploadResponse)
  @EasyThrottle(20)
  async uploadImage(
    @PostFiles(1) multipart: FileIterator,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageDeleteKey) withDeleteKey: boolean,
  ): Promise<ImageUploadResponse> {
    const file = ThrowIfFailed(await GetNextAsync(multipart));

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (e) {
      throw MapUploadError(e, this.multipartConfig.getMaxFileSize());
    }

    if (buffer.length === 0) {
      throw Fail(FT.UsrValidation, 'The uploaded file is empty');
    }

    const image = ThrowIfFailed(
      await this.imagesService.upload(
        userid,
        file.filename,
        buffer,
        withDeleteKey,
      ),
    );

    return image;
  }

  @Post('list')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageListResponse)
  async listMyImagesPaged(
    @Body() body: ImageListRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageListResponse> {
    if (!isImageAdmin) {
      body.user_id = userid;
    }

    const found = ThrowIfFailed(
      await this.imagesService.findMany(body.count, body.page, body.user_id),
    );

    return found;
  }

  @Post('list/all')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageListAllResponse)
  async listAllMyImages(
    @Body() body: ImageListAllRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageListAllResponse> {
    if (!isImageAdmin) {
      body.user_id = userid;
    }

    const found = ThrowIfFailed(
      await this.imagesService.findAll(body.user_id, body.count, body.page),
    );

    return found;
  }

  @Post('update')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageUpdateResponse)
  async updateImage(
    @Body() body: ImageUpdateRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageUpdateResponse> {
    const user_id = isImageAdmin ? undefined : userid;

    const image = ThrowIfFailed(
      await this.imagesService.update(body.id, user_id, body),
    );

    return image;
  }

  @Post('delete')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageDeleteResponse)
  async deleteImage(
    @Body() body: ImageDeleteRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageDeleteResponse> {
    const deletedImages = ThrowIfFailed(
      await this.imagesService.deleteMany(
        body.ids,
        isImageAdmin ? undefined : userid,
      ),
    );

    return {
      images: deletedImages,
    };
  }

  @Post('delete/key')
  @RequiredPermissions(Permission.ImageDeleteKey)
  @Returns(ImageDeleteWithKeyResponse)
  async deleteImageWithKeyGet(
    @Body() body: ImageDeleteWithKeyRequest,
  ): Promise<ImageDeleteWithKeyResponse> {
    return ThrowIfFailed(
      await this.imagesService.deleteWithKey(body.id, body.key),
    );
  }

  @Get('delete/:id/:key')
  @RequiredPermissions(Permission.ImageDeleteKey)
  async deleteImageWithKeyPost(
    @Param() params: ImageDeleteWithKeyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    const image = await this.imagesService.deleteWithKey(params.id, params.key);
    if (HasFailed(image)) {
      res.header('Location', '/error/delete-failure');
      res.code(302);
      return 'Failed to delete image';
    }

    res.header('Location', '/error/delete-success');
    res.code(302);
    return 'Successfully deleted image';
  }
}
