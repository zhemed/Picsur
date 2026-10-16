import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { In, LessThan, Repository } from 'typeorm';
import { EImageBackend } from '../../database/entities/images/image.entity.js';

/** Page size used when `/api/image/list/all` is called without one. */
export const ImageListAllPageSize = 100;
/** Hard upper bound for a single `/api/image/list/all` response. */
export const ImageListAllMaxPageSize = 1000;

@Injectable()
export class ImageDBService {
  constructor(
    @InjectRepository(EImageBackend)
    private readonly imageRepo: Repository<EImageBackend>,
  ) {}

  public async create(
    userid: string,
    filename: string,
    sourceFiletype: string,
    dimensions: { width?: number; height?: number },
    withDeleteKey: boolean,
  ): AsyncFailable<EImageBackend> {
    let imageEntity = new EImageBackend();
    imageEntity.user_id = userid;
    imageEntity.created = new Date();
    imageEntity.file_name = filename;
    imageEntity.source_filetype = sourceFiletype;
    // Unknown for formats we store without decoding (SVG) - stays null.
    imageEntity.width = dimensions.width ?? null;
    imageEntity.height = dimensions.height ?? null;
    if (withDeleteKey) imageEntity.delete_key = generateRandomString(32);

    try {
      imageEntity = await this.imageRepo.save(imageEntity, {
        reload: true,
      });

      if (imageEntity.delete_key === null) delete imageEntity.delete_key;
      return imageEntity;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findOne(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findMany(
    count: number,
    page: number,
    userid: string | undefined,
  ): AsyncFailable<FindResult<EImageBackend>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [found, amount] = await this.imageRepo.findAndCount({
        skip: count * page,
        take: count,
        order: { created: 'DESC' },
        where: {
          user_id: userid,
        },
      });

      if (found === undefined) return Fail(FT.NotFound, 'Images not found');

      return {
        results: found,
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  /**
   * Every image of a user, capped.
   *
   * The endpoint this backs had no pagination and no bound at all: one call
   * pulled the full history of the account (audit A-9). `total` always reports
   * the real number, so a caller can tell that the list was cut short.
   */
  public async findAll(
    userid: string | undefined,
    count?: number,
    page?: number,
  ): AsyncFailable<{ results: EImageBackend[]; total: number }> {
    try {
      const take = Math.min(
        count ?? ImageListAllPageSize,
        ImageListAllMaxPageSize,
      );
      const skip = count === undefined ? 0 : Math.max(page ?? 0, 0) * take;

      const [found, amount] = await this.imageRepo.findAndCount({
        order: { created: 'DESC' },
        where: {
          user_id: userid,
        },
        take,
        skip,
      });

      if (found === undefined) return Fail(FT.NotFound, 'Images not found');

      return {
        results: found,
        total: amount,
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async count(): AsyncFailable<number> {
    try {
      return await this.imageRepo.count();
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async update(
    id: string,
    userid: string | undefined,
    options: Partial<Pick<EImageBackend, 'file_name' | 'expires_at'>>,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      if (options.file_name !== undefined) found.file_name = options.file_name;

      if (options.expires_at !== undefined)
        found.expires_at = options.expires_at;

      await this.imageRepo.save(found);

      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async delete(
    ids: string[],
    userid: string | undefined,
  ): AsyncFailable<EImageBackend[]> {
    if (ids.length === 0) return [];
    if (ids.length > 500) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const deletable_images = await this.imageRepo.find({
        where: {
          id: In(ids),
          user_id: userid,
        },
      });

      const available_ids = deletable_images.map((i) => i.id);

      if (available_ids.length === 0)
        return Fail(FT.NotFound, 'Images not found');

      await this.imageRepo.delete({ id: In(available_ids) });

      return deletable_images;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async deleteWithKey(
    id: string,
    key: string,
  ): AsyncFailable<EImageBackend> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, delete_key: key },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      await this.imageRepo.delete({ id: found.id });

      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async deleteAll(IAmSure: boolean): AsyncFailable<true> {
    if (!IAmSure)
      return Fail(
        FT.SysValidation,
        'You must confirm that you want to delete all images',
      );

    try {
      await this.imageRepo.delete({});
    } catch (e) {
      return Fail(FT.Database, e);
    }
    return true;
  }

  public async cleanupExpired(): AsyncFailable<number> {
    try {
      const res = await this.imageRepo.delete({
        expires_at: LessThan(new Date()),
      });

      return res.affected ?? 0;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }
}
