import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { EImageDerivativeBackend } from './image-derivative.entity.js';
import { EImageFileBackend } from './image-file.entity.js';

@Entity()
export class EImageBackend implements EImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    nullable: false,
    type: 'uuid',
  })
  user_id: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  created: Date;

  @Column({
    nullable: false,
    default: 'image',
  })
  file_name: string;

  // Filetype the user actually uploaded, before the internal transcode.
  // Nullable: rows created before this column existed have no value.
  @Column({
    type: 'varchar',
    nullable: true,
  })
  source_filetype: string | null;

  // Pixel size of the original. Recorded while the upload is transcoded (the
  // sharp worker already reports the output size, so this costs no extra
  // decode). Nullable: rows from before these columns exist, and formats that
  // are stored without decoding, keep null and clients fall back to measuring
  // the picture once it has loaded.
  @Column({
    type: 'int',
    nullable: true,
  })
  width: number | null;

  @Column({
    type: 'int',
    nullable: true,
  })
  height: number | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  expires_at: Date | null;

  @Column({
    nullable: true,
    select: false,
  })
  delete_key?: string;

  @OneToMany(() => EImageDerivativeBackend, (derivative) => derivative.image_id)
  derivatives: EImageDerivativeBackend[];

  @OneToMany(() => EImageFileBackend, (file) => file.image_id)
  files: EImageFileBackend[];
}
