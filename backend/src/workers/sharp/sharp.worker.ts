import { FileType } from 'picsur-shared/dist/dto/mimes.dto';
import {
  DecodeFailureReason,
  IsPixelLimitError,
  EncodePixelLimitFailure,
  ReadMaxImagePixels,
} from 'picsur-shared/dist/util/image-pixel-limit';
import { setrlimit } from 'posix.js';
import { Sharp } from 'sharp';
import {
  SharpWorkerFinishOptions,
  SharpWorkerInitMessage,
  SharpWorkerOperationMessage,
  SharpWorkerRecieveMessage,
  SharpWorkerSendMessage,
} from './sharp.message.js';
import { UniversalSharpIn, UniversalSharpOut } from './universal-sharp.js';

function DescribeError(error: any): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export class SharpWorker {
  private startTime = 0;
  private sharpi: Sharp | null = null;
  private maxImagePixels = 0;

  constructor() {
    this.setup();
  }

  private setup() {
    if (process.send === undefined) {
      return this.purge('This is not a worker process');
    }

    const memoryLimit = parseInt(process.env['MEMORY_LIMIT_MB'] ?? '');

    if (isNaN(memoryLimit) || memoryLimit <= 0) {
      return this.purge('MEMORY_LIMIT_MB environment variable is not set');
    }

    // The main process normally rejects oversized images before spawning this
    // worker; this is the last line of defence (issue #107).
    this.maxImagePixels = ReadMaxImagePixels(process.env['MAX_IMAGE_PIXELS']);

    try {
      setrlimit('data', {
        soft: 1000 * 1000 * memoryLimit,
        hard: 1000 * 1000 * memoryLimit,
      });
    } catch (e) {
      console.warn('Failed to set memory limit');
    }

    process.on('message', this.messageHandler.bind(this));

    this.sendMessage({
      type: 'ready',
    });
  }

  private messageHandler(message: SharpWorkerSendMessage): void {
    if (message.type === 'init') {
      this.init(message);
    } else if (message.type === 'operation') {
      this.operation(message);
    } else if (message.type === 'finish') {
      this.finish(message.filetype, message.options);
    } else {
      return this.purge('Unknown message type');
    }
  }

  private init(message: SharpWorkerInitMessage): void {
    if (this.sharpi !== null) {
      return this.purge('Already initialized');
    }

    this.startTime = Date.now();

    try {
      this.sharpi = UniversalSharpIn(
        message.image,
        message.filetype,
        message.options,
      );
    } catch (e) {
      // Unreadable input is a user error, not a server crash (issue #107).
      return this.fail(DecodeFailureReason(DescribeError(e)));
    }
  }

  private operation(message: SharpWorkerOperationMessage): void {
    if (this.sharpi === null) {
      return this.purge('Not initialized');
    }

    const operation = message.operation;
    // Deferred (task 10-15-backlog-clear): leftover from upstream, this
    // expression has no effect. Kept as-is instead of guessing the intent.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    message.operation.parameters;

    this.sharpi = (this.sharpi[operation.name] as any)(...operation.parameters);
  }

  private async finish(
    filetype: FileType,
    options: SharpWorkerFinishOptions,
  ): Promise<void> {
    if (this.sharpi === null) {
      return this.purge('Not initialized');
    }

    const sharpi = this.sharpi;
    this.sharpi = null;

    try {
      const result = await UniversalSharpOut(sharpi, filetype, options);
      const processingTime = Date.now() - this.startTime;

      this.sendMessage({
        type: 'result',
        processingTime,
        result,
      });
    } catch (e) {
      const message = DescribeError(e);
      const reason = IsPixelLimitError(message)
        ? EncodePixelLimitFailure(this.maxImagePixels)
        : DecodeFailureReason(message);

      return this.fail(reason);
    }
  }

  private sendMessage(message: SharpWorkerRecieveMessage): void {
    if (process.send === undefined) {
      return this.purge('This is not a worker process');
    }

    process.send(message);
  }

  /** Report a user facing failure back to the main process instead of dying. */
  private fail(reason: string): void {
    this.sendMessage({
      type: 'result',
      processingTime: Date.now() - this.startTime,
      failure: reason,
    });
    process.exit(0);
  }

  private purge(reason: any): void {
    if (typeof reason === 'string') {
      console.error(new Error(reason));
    } else {
      console.error(reason);
    }
    process.exit(1);
  }
}

new SharpWorker();
