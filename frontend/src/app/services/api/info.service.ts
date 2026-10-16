import { Inject, Injectable } from '@angular/core';
import { LOCATION } from '@ng-web-apis/common';
import { InfoResponse } from 'picsur-shared/dist/dto/api/info.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { BehaviorSubject, filter, Observable, take } from 'rxjs';
import pkg from '../../../../package.json';
import { ServerInfo } from '../../models/dto/server-info.dto';
import { Logger } from '../logger/logger.service';
import { InfoStorageService } from '../storage/info-storage.service';
import { ApiService } from './api.service';

/**
 * How long {@link InfoService.getLoadedSnapshot} waits for `/api/info` before
 * giving up and reporting a failure. Without a bound, a server (or proxy) that
 * never answers left the returned promise pending forever, so every caller
 * waiting for the server info hung with it.
 */
const INFO_LOAD_TIMEOUT_MS = 5000;

@Injectable({
  providedIn: 'root',
})
export class InfoService {
  private readonly logger = new Logger(InfoService.name);

  /**
   * Resolves when the server info has actually been fetched.
   *
   * This must not be a `BehaviorSubject<ServerInfo>` holding a placeholder:
   * callers then cannot tell "the server reported 0.0.0" apart from "we have
   * not loaded anything yet", and the old `filter(version !== '0.0.0')` walk
   * waited for a value that a real server is allowed to report. `null` is the
   * single source of truth for "not loaded".
   */
  private readonly loadedInfo = new BehaviorSubject<ServerInfo | null>(null);

  /** Set as soon as this session got an answer from *this* server. */
  private loadedFromServer = false;

  public get live(): Observable<ServerInfo | null> {
    return this.loadedInfo.asObservable();
  }

  /** Cached snapshot, or a default `ServerInfo` while nothing is loaded. */
  public get snapshot(): ServerInfo {
    return this.loadedInfo.value ?? new ServerInfo();
  }

  constructor(
    @Inject(LOCATION) private readonly location: Location,
    private readonly api: ApiService,
    private readonly infoStorage: InfoStorageService,
  ) {
    // Seed from the previous visit so the first render has the tracking state
    // and host override available. `isLoaded()` stays false for cached data:
    // only a fresh response from this server counts as loaded.
    const cached = this.infoStorage?.get();
    if (cached !== undefined && cached !== null) {
      this.loadedInfo.next(cached);
    }

    this.updateInfo().catch((e) => this.logger.warn(e));
  }

  /**
   * The server info, waiting for the first successful `/api/info` response.
   *
   * Rejects with a `Failure` instead of hanging: either the response arrives,
   * or the request fails, or `INFO_LOAD_TIMEOUT_MS` passes. Callers can rely
   * on this promise always settling.
   */
  public async getLoadedSnapshot(): AsyncFailable<ServerInfo> {
    const loaded = this.loadedInfo.value;
    if (loaded !== null && this.isLoaded()) return loaded;

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const subscription = this.loadedInfo
        .pipe(
          // Cached info alone must not satisfy the wait.
          filter((info) => this.isLoaded() && info !== null),
          take(1),
        )
        .subscribe((info) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(info as ServerInfo);
        });

      timer = setTimeout(() => {
        subscription.unsubscribe();
        reject(
          Fail(
            FT.Network,
            `Server info was not available within ${INFO_LOAD_TIMEOUT_MS}ms`,
          ),
        );
      }, INFO_LOAD_TIMEOUT_MS);
    });
  }

  public getFrontendVersion(): string {
    return pkg.version;
  }

  public getHostname(allowOverride = false): string {
    if (allowOverride) {
      const info = this.loadedInfo.value;

      if (info?.host_override !== undefined) {
        return info.host_override;
      }
    }

    return this.location.protocol + '//' + this.location.host;
  }

  /**
   * True once *this* server answered `/api/info`, cached data does not count.
   *
   * This must not be `loadedInfo.value !== null`: the constructor seeds that
   * subject from the previous visit, so the flag used to be true before this
   * session had talked to the server at all, and `getLoadedSnapshot()` handed
   * the *stored* info to its callers instead of waiting for a real answer.
   */
  public isLoaded(): boolean {
    return this.loadedFromServer;
  }

  private async updateInfo(): AsyncFailable<ServerInfo> {
    const response = await this.api.get(InfoResponse, '/api/info').result;
    if (HasFailed(response)) return response;

    this.loadedFromServer = true;
    this.loadedInfo.next(response);
    this.infoStorage.set(response);
    return response;
  }
}
