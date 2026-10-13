import { z } from 'zod';
import { createZodDto } from '../../util/create-zod-dto.js';

// Tags are interpolated into the Docker API URL, so keep them boring.
// https://docs.docker.com/engine/reference/commandline/tag/#extended-description
export const DockerTagRegex = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const UpdateStateEnum = z.enum([
  'idle',
  'running',
  'success',
  'failed',
]);
export type UpdateState = z.infer<typeof UpdateStateEnum>;

export const UpdateStatusSchema = z.object({
  state: UpdateStateEnum,
  message: z.string().nullable(),
});
export class UpdateStatus extends createZodDto(UpdateStatusSchema) {}

// POST /api/system/update/check
export const UpdateCheckResponseSchema = z.object({
  /** Version this instance is currently running (same source as /api/info). */
  current: z.string(),
  /** Highest version found on GitHub, null when the check is disabled/failed. */
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
  /** false when PICSUR_UPDATE_CHECK=false */
  checkEnabled: z.boolean(),
  /** false unless PICSUR_ALLOW_SELF_UPDATE=true */
  selfUpdateEnabled: z.boolean(),
  /** Command the admin can run to update by hand (always present). */
  command: z.string(),
  /** Human readable status, null when everything is normal. */
  message: z.string().nullable(),
  /** State of the (self) update process. */
  lastUpdate: UpdateStatusSchema,
});
export class UpdateCheckResponse extends createZodDto(
  UpdateCheckResponseSchema,
) {}

// POST /api/system/update/apply
export const UpdateApplyRequestSchema = z.object({
  /** Optional explicit tag, falls back to the newest known tag / 'latest'. */
  tag: z.string().regex(DockerTagRegex).optional(),
});
export class UpdateApplyRequest extends createZodDto(
  UpdateApplyRequestSchema,
) {}

export const UpdateApplyResponseSchema = z.object({
  /** Always true, the actual update runs after this response was sent. */
  started: z.boolean(),
  current: z.string(),
  /** Full image reference that is going to be deployed. */
  image: z.string(),
  tag: z.string(),
});
export class UpdateApplyResponse extends createZodDto(
  UpdateApplyResponseSchema,
) {}
