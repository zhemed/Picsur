import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which filetype the user actually uploaded.
 *
 * The stored master file is always transcoded to an internal format (QOI,
 * WEBP, ...), so without this column there is no way to tell whether an upload
 * was a PNG. The web UI uses it to preselect the original format instead of
 * always falling back to JPEG.
 */
export class AddImageSourceFiletype1780617600000 implements MigrationInterface {
  name = 'AddImageSourceFiletype1780617600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" ADD COLUMN IF NOT EXISTS "source_filetype" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" DROP COLUMN IF EXISTS "source_filetype"`,
    );
  }
}
