import { Component, Inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';

import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import {
  BehaviorSubject,
  Observable,
  filter,
  map,
  merge,
  switchMap,
  timer,
} from 'rxjs';
import { WINDOW } from '@ng-web-apis/common';
import { ImageService } from '../../services/api/image.service';
import { UserService } from '../../services/api/user.service';
import { Logger } from '../../services/logger/logger.service';
import { BSScreenSize, BootstrapService } from '../../util/bootstrap.service';
import { DialogService } from '../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../util/error-manager/error.service';

@Component({
  standalone: false,
  templateUrl: './images.component.html',
  styleUrls: ['./images.component.scss'],
})
export class ImagesComponent implements OnInit {
  private readonly logger: Logger = new Logger(ImagesComponent.name);

  imagesSub = new BehaviorSubject<EImage[] | null>(null);

  /** Cards per row; kept in sync with the grid breakpoints in the SCSS. */
  columns = 1;

  /**
   * Pictures whose own size is smaller than the card's thumbnail box.
   *
   * Those must not be stretched to fill the box — that is upscaling and it is
   * what made the gallery look blurry. They are drawn at their own size.
   */
  smallThumbs = new Set<string>();

  /** CSS pixel width of one card, used to size the derivative request. */
  private cardWidth = 320;

  /**
   * Thumbnail URLs that were re-requested after the first decode showed they
   * were too small. Keyed by image id.
   */
  private thumbOverrides = new Map<string, string>();

  /** Width (in source pixels) each image was last requested at. */
  private thumbRequests = new Map<string, number>();

  public get images() {
    const value = this.imagesSub.value;
    return (
      value?.filter(
        (i) => i.expires_at === null || i.expires_at > new Date(),
      ) ?? null
    );
  }

  page = 1;
  pages = 1;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly bootstrapService: BootstrapService,
    private readonly userService: UserService,
    private readonly imageService: ImageService,
    private readonly errorService: ErrorService,
    private readonly dialogService: DialogService,
    private readonly i18n: I18nService,
    @Inject(WINDOW) private readonly windowRef: Window,
  ) {}

  ngOnInit() {
    this.load().catch(this.logger.error);
  }

  private async load() {
    const params = this.route.snapshot.paramMap;

    let thispage = Number(params.get('page') ?? '');
    if (isNaN(thispage) || thispage <= 0) thispage = 1;
    this.page = thispage;

    this.subscribeMobile();
    this.subscribeUser();
    this.subscribeImages();
  }

  @AutoUnsubscribe()
  private subscribeMobile() {
    return this.bootstrapService.screenSize().subscribe((size) => {
      // Same breakpoints as `.gallery-grid` in the SCSS: 4 / 3 / 2 / 1.
      if (size <= BSScreenSize.sm) {
        this.columns = 1;
      } else if (size <= BSScreenSize.md) {
        this.columns = 2;
      } else if (size <= BSScreenSize.xl) {
        this.columns = 3;
      } else {
        this.columns = 4;
      }

      this.cardWidth = this.measureCardWidth();
    });
  }

  /**
   * Width of one card in CSS pixels, derived from the viewport and the grid
   * breakpoints (page padding 16px each side, 16px gaps).
   */
  private measureCardWidth(): number {
    const viewport = this.windowRef.innerWidth || 1024;
    const padding = 32;
    const gaps = (this.columns - 1) * 16;
    return Math.max(120, (viewport - padding - gaps) / this.columns);
  }

  @AutoUnsubscribe()
  private subscribeUser() {
    return this.userService.live.subscribe(async (user) => {
      if (user === null) return;

      const list = await this.imageService.ListMyImages(24, this.page - 1);
      if (HasFailed(list)) {
        return this.logger.error(list.getReason());
      }

      this.pages = list.pages;
      this.imagesSub.next(list.results);
    });
  }

  @AutoUnsubscribe()
  private subscribeImages() {
    // Make sure we only get populated images
    const filteredImagesSub: Observable<EImage[]> = this.imagesSub.pipe(
      filter((images) => images !== null),
    ) as Observable<EImage[]>;

    const mappedImagesSub: Observable<EImage> = filteredImagesSub.pipe(
      // Everytime we get a new array, we want merge a mapping of that array
      // In this mapping, each image will emit itself on the expire date
      switchMap((images: EImage[]) =>
        merge(
          ...images
            .filter((i) => i.expires_at !== null)
            .map((i) => timer(i.expires_at ?? new Date(0)).pipe(map(() => i))),
        ),
      ),
    ) as Observable<EImage>;

    return mappedImagesSub.subscribe((image) => {
      this.imagesSub.next(
        this.images?.filter((i) => i.id !== image.id) ?? null,
      );
    });
  }

  /**
   * Thumbnail URL that matches how big the picture is actually drawn.
   *
   * The old request asked for `height=480` no matter what the card showed, so
   * a portrait picture came back 240x480 and was then stretched over a 408px
   * wide box (1.7x upscaling — the blur the owner reported), while a wide
   * picture got a 1440px file for a 408px slot. Now the request is derived from
   * the card width times the screen density, with headroom for the crop that
   * `object-fit: cover` does, and `shrinkonly=yes` keeps the server from
   * inventing pixels the original does not have.
   *
   * When the list gave us the original's size, that headroom is not a guess any
   * more: the size the card draws at can be worked out up front, so the picture
   * never has to be measured and re-requested.
   */
  getThumbnailUrl(image: EImage) {
    const override = this.thumbOverrides.get(image.id);
    if (override !== undefined) return override;

    const { width: sourceWidth, height: sourceHeight } = image;
    const known =
      sourceWidth !== null &&
      sourceHeight !== null &&
      sourceWidth > 0 &&
      sourceHeight > 0;

    const width = known
      ? this.exactThumbWidth(sourceWidth, sourceHeight)
      : this.defaultThumbWidth();

    this.thumbRequests.set(image.id, width);
    return this.buildThumbUrl(image, width);
  }

  /** True when the API told us the original's pixel size. */
  private hasKnownSize(image: EImage): boolean {
    return (
      image.width !== null &&
      image.height !== null &&
      image.width > 0 &&
      image.height > 0
    );
  }

  /**
   * Should this thumbnail be drawn at its own size instead of filling the box?
   *
   * Pure on purpose (the template calls it): when the original's size is known
   * the answer is available before the picture even loads, which keeps a small
   * picture from flashing upscaled for one frame. Measured pictures land in
   * `smallThumbs` once they have loaded.
   */
  public isSmallThumb(image: EImage): boolean {
    if (this.smallThumbs.has(image.id)) return true;
    if (!this.hasKnownSize(image)) return false;

    const boxHeight = this.cardWidth * (3 / 4); // .gallery-thumb is 4:3
    return (image.width ?? 0) < this.cardWidth || (image.height ?? 0) < boxHeight;
  }

  /**
   * Width in source pixels a card actually draws, derived from the original's
   * own size.
   *
   * `object-fit: cover` scales until the picture covers the box, so the drawn
   * width follows whichever ratio is larger, and the screen then needs that
   * many physical pixels. This is the same number `correctThumbSize` works out
   * after measuring - computing it here makes the first request the right one.
   *
   * The request is deliberately not clamped to the original's own width: when
   * the original is too small for the slot, asking for the honestly needed size
   * is what lets the server say "this is all there is" (`shrinkonly=yes` still
   * refuses to enlarge), and it is how the caller can tell a too-small original
   * apart from an undersized request.
   */
  private exactThumbWidth(sourceWidth: number, sourceHeight: number): number {
    const density = this.windowRef.devicePixelRatio || 1;
    const boxWidth = this.cardWidth;
    const boxHeight = this.cardWidth * (3 / 4); // .gallery-thumb is 4:3

    const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const needed = Math.ceil(sourceWidth * scale * density);

    return Math.min(2560, Math.max(160, needed));
  }

  /** Width in pixels the current thumbnail was requested at (for the probe). */
  public thumbRequestWidth(image: EImage): number | null {
    return this.thumbRequests.get(image.id) ?? null;
  }

  private defaultThumbWidth(): number {
    const density = this.windowRef.devicePixelRatio || 1;
    // 1.5x headroom: a 16:9 picture cropped into a 4:3 box is drawn 1.33x wider.
    const target = Math.round(this.cardWidth * density * 1.5);
    return Math.min(1600, Math.max(160, target));
  }

  private buildThumbUrl(image: EImage, width: number): string {
    return (
      this.imageService.GetImageURL(image.id, ImageFileType.QOI) +
      `?width=${width}&shrinkonly=yes`
    );
  }

  /**
   * Remembers pictures that are smaller than their box, so they are drawn 1:1
   * instead of being blown up.
   */
  onThumbLoaded(image: EImage, size: { width: number; height: number }) {
    const boxWidth = this.cardWidth;
    const boxHeight = this.cardWidth * (3 / 4); // .gallery-thumb is 4:3

    const fits = size.width >= boxWidth && size.height >= boxHeight;
    if (fits) {
      this.smallThumbs.delete(image.id);
    } else {
      this.smallThumbs.add(image.id);
    }

    // The request was already derived from the size the list gave us, so
    // measuring the decoded picture cannot turn up anything new. Correcting
    // here is precisely the second request this feature removes; when the size
    // is unknown the old measure-then-correct path still runs.
    if (this.hasKnownSize(image)) return;

    this.correctThumbSize(image, size, { width: boxWidth, height: boxHeight });
  }

  /**
   * Ask for a bigger derivative when the first one turns out too small.
   *
   * A fixed card box crops with `object-fit: cover`, so the drawn width is not
   * the box width: an ultra wide picture is drawn `aspect / (4/3)` times wider,
   * and on a 2x screen it needs twice the pixels again. The first request only
   * guesses, so once the real dimensions are known, re-request exactly what the
   * card shows (`shrinkonly=yes` still keeps the server from inventing pixels —
   * a small original simply stays 1:1 instead of being blown up).
   */
  private correctThumbSize(
    image: EImage,
    size: { width: number; height: number },
    box: { width: number; height: number },
  ) {
    const density = this.windowRef.devicePixelRatio || 1;
    const scale = Math.max(box.width / size.width, box.height / size.height);
    const needed = Math.ceil(size.width * scale * density);

    const requested = this.thumbRequests.get(image.id) ?? 0;
    if (needed <= size.width * 1.05) return; // the source is the limit, done
    if (needed <= requested) return; // already asked for enough

    const width = Math.min(2560, needed);
    this.thumbRequests.set(image.id, width);
    this.thumbOverrides.set(image.id, this.buildThumbUrl(image, width));
  }

  viewImage(image: EImage) {
    this.router.navigate(['/view', image.id]);
  }

  async deleteImage(image: EImage) {
    const pressedButton = await this.dialogService.showDialog({
      title: this.i18n.instant('images.deleteConfirmTitle'),
      description: this.i18n.instant('images.deleteConfirmDescription'),
      buttons: [
        {
          name: 'cancel',
          text: this.i18n.instant('common.actions.cancel'),
        },
        {
          color: 'warn',
          name: 'delete',
          text: this.i18n.instant('common.actions.delete'),
        },
      ],
    });

    if (pressedButton === 'delete') {
      const result = await this.imageService.DeleteImage(image.id ?? '');
      if (HasFailed(result))
        return this.errorService.showFailure(result, this.logger);

      this.errorService.success(this.i18n.instant('images.deleted'));
      this.imagesSub.next(
        this.images?.filter((i) => i.id !== image.id) ?? null,
      );
    }
  }

  gotoPage(page: number) {
    this.router.navigate(['/images', page]).then(() => {
      this.load().catch(this.logger.error);
    });
  }
}
