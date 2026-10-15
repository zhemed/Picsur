import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { FileType, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { AsyncFailable, HasFailed } from 'picsur-shared/dist/types/failable';
import { URLRegex } from 'picsur-shared/dist/util/common-regex';
import { ParseMime2FileType } from 'picsur-shared/dist/util/parse-mime';
import { ApiService } from '../../services/api/api.service';
import { Logger } from '../../services/logger/logger.service';
import { QoiWorkerService } from '../../workers/qoi-worker.service';

enum PicsurImgState {
  Init = 'init',
  Loading = 'loading',
  Canvas = 'canvas',
  Image = 'image',
  Error = 'error',
}

@Component({
  standalone: false,
  selector: 'picsur-img',
  templateUrl: './picsur-img.component.html',
  styleUrls: ['./picsur-img.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PicsurImgComponent implements OnChanges, OnDestroy {
  private readonly logger = new Logger(PicsurImgComponent.name);

  /**
   * Blob URL of the image that is currently displayed. It has to be revoked
   * by hand, otherwise every loaded image stays in memory until the page is
   * unloaded.
   */
  private objectURL: string | null = null;

  @ViewChild('targetcanvas') private canvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('targetimg') private img: ElementRef<HTMLImageElement>;

  private isInView = false;

  @Input('src') imageURL: string | undefined;

  public state: PicsurImgState = PicsurImgState.Init;

  constructor(
    private readonly qoiWorker: QoiWorkerService,
    private readonly apiService: ApiService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnChanges(): void {
    if (this.isInView) this.reload();
  }

  ngOnDestroy(): void {
    this.releaseObjectURL();
  }

  private reload() {
    const url = this.imageURL ?? '';
    if (!URLRegex.test(url)) {
      this.state = PicsurImgState.Loading;
      this.changeDetector.markForCheck();
      return;
    }

    this.update(url)
      .then((result) => {
        if (HasFailed(result)) {
          this.releaseObjectURL();
          this.state = PicsurImgState.Error;
          this.logger.error(result.getReason());
          this.changeDetector.markForCheck();
        }
      })
      .catch(this.logger.error);
  }

  private async update(url: string): AsyncFailable<void> {
    const filetype = await this.getFileType(url);
    if (HasFailed(filetype)) return filetype;

    if (filetype.identifier === ImageFileType.QOI) {
      const result = await this.qoiWorker.decode(url);
      if (HasFailed(result)) return result;

      this.releaseObjectURL();

      const canvas = this.canvas.nativeElement;
      canvas.height = result.height;
      canvas.width = result.width;
      canvas.getContext('2d')?.putImageData(result.data, 0, 0);

      this.state = PicsurImgState.Canvas;
    } else {
      const result = await this.apiService.getBuffer(url).result;
      if (HasFailed(result)) return result;

      const img = this.img.nativeElement;

      const blob = new Blob([result.buffer]);
      const previousObjectURL = this.objectURL;
      this.objectURL = URL.createObjectURL(blob);
      img.src = this.objectURL;

      // Only revoke the old URL once the browser switched to the new one.
      if (previousObjectURL !== null) URL.revokeObjectURL(previousObjectURL);

      this.state = PicsurImgState.Image;
    }
    this.changeDetector.markForCheck();
  }

  private releaseObjectURL(): void {
    if (this.objectURL === null) return;

    URL.revokeObjectURL(this.objectURL);
    this.objectURL = null;
  }

  private async getFileType(url: string): AsyncFailable<FileType> {
    const response = await this.apiService.head(url).result;
    if (HasFailed(response)) {
      return response;
    }

    // axios 1.20 types header values as string | number | boolean | string[]
    // | AxiosHeaders, so normalise before splitting off the parameters.
    const mimeHeader = String(response['content-type'] ?? '');
    const mime = mimeHeader.split(';')[0];

    return ParseMime2FileType(mime);
  }

  onInview() {
    this.isInView = true;

    if (this.state === PicsurImgState.Init) {
      this.state = PicsurImgState.Loading;
      this.changeDetector.markForCheck();

      this.reload();
    }
  }

  onOutview() {
    this.isInView = false;
  }
}
