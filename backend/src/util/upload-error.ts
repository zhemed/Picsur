import { Fail, Failure, FT } from 'picsur-shared/dist/types/failable';

/**
 * Translate a `@fastify/multipart` / busboy error into a client error.
 *
 * Everything that goes wrong while reading an upload used to be wrapped as
 * `FT.Internal`, so a file over `PICSUR_MAX_FILE_SIZE` answered
 * `500 "An internal error occurred"` (audit A-6). None of these cases are
 * server faults.
 */
export function MapUploadError(
  error: unknown,
  maxFileSize: number,
): Failure {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;

  switch (code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return Fail(
        FT.PayloadTooLarge,
        `The uploaded file is larger than the maximum of ${maxFileSize} bytes`,
        error,
      );
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return Fail(
        FT.UsrValidation,
        'Too many files or fields in this upload',
        error,
      );
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_INVALID_JSON_FIELD_ERROR':
      return Fail(FT.UsrValidation, 'Invalid multipart upload', error);
    default:
      break;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/aborted|econnreset|premature close|socket hang up/i.test(message)) {
    // The client went away while uploading; nothing to answer, but it must not
    // be reported as a server fault.
    return Fail(FT.BadRequest, 'The upload was interrupted', error);
  }

  return Fail(FT.UsrValidation, 'Could not read the uploaded file', error);
}
