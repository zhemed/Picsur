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
   *
   * `0` is accepted as well as null. The columns were introduced in 0.10.2, so
   * an upgraded instance can hold rows this code did not write; rejecting a
   * stored value here turns "a row from the old version" into a 500 on the
   * whole listing (validation runs on our own response), which blanks the
   * gallery. A meaningless size is a display problem, never a request failure.
   */
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  expires_at: z.preprocess((data: any) => new Date(data), z.date()).nullable(),
});
export type EImage = z.infer<typeof EImageSchema>;
