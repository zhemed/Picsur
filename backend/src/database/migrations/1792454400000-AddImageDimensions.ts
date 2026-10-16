import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the pixel size of the uploaded original on the image row, so the
 * gallery can ask for a derivative at the right size on the first try instead
 * of requesting one, measuring it, and requesting again.
 *
 * Both columns are nullable and stay null for everything uploaded before this
 * migration - deliberately: backfilling would mean decoding every historic
 * image, and clients already have to handle "size unknown" (they measure the
 * picture after it loads). Nothing is dropped or rewritten.
 */
export class AddImageDimensions1792454400000 implements MigrationInterface {
  name = 'AddImageDimensions1792454400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" ADD COLUMN IF NOT EXISTS "width" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" ADD COLUMN IF NOT EXISTS "height" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" DROP COLUMN IF EXISTS "width"`,
    );
    await queryRunner.query(
      `ALTER TABLE "e_image_backend" DROP COLUMN IF EXISTS "height"`,
    );
  }
}
