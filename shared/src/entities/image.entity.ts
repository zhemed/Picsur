import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';

export const EImageSchema = z.object({
  id: IsEntityID(),
  user_id: IsEntityID(),
  created: z.preprocess((data: any) => new Date(data), z.date()),
  file_name: z.string(),
  source_filetype: z.string().nullable(),
  /**
   * Pixel size of the uploaded original.
   *
   * Null when it was never recorded: images uploaded before these columns
   * existed, and formats we store without decoding (SVG). Clients must treat
   * null as "unknown" and fall back to measuring the picture after it loads.
   */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  expires_at: z.preprocess((data: any) => new Date(data), z.date()).nullable(),
});
export type EImage = z.infer<typeof EImageSchema>;
