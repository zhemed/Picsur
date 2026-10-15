import { Injectable, Logger } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { Fail, FT } from 'picsur-shared/dist/types/failable';
import { UpdateConfigService } from '../../config/late/update.config.service.js';

// Minimal Docker Engine API client.
//
// It only speaks to the local docker socket and only implements the handful of
// endpoints the self updater needs. No docker CLI, no extra dependency: node's
// http module supports unix sockets natively (`socketPath`).
//
// The response is used through this small structural type: `@fastify/busboy`
// augments `stream.Readable` in a way that makes the event overloads of
// `IncomingMessage.on()` unusable in this project (tsc then only accepts
// 'limit' as the event name).
interface RawHttpResponse {
  statusCode?: number;
  setEncoding(encoding: BufferEncoding): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
}

export interface DockerContainerSummary {
  Id: string;
  Names: string[];
  Created: number;
  State: string;
  Status: string;
  Labels: Record<string, string>;
  Image: string;
  ImageID: string;
}

export interface DockerPortBinding {
  HostIp?: string;
  HostPort?: string;
}

export interface DockerMount {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
  RW: boolean;
  Mode?: string;
}

export interface DockerContainerInspect {
  Id: string;
  Name: string;
  Created: string;
  Image: string;
  Config: {
    Image: string;
    Hostname: string;
    Env?: string[];
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
    WorkingDir?: string;
    User?: string;
    Labels?: Record<string, string> | null;
    ExposedPorts?: Record<string, unknown> | null;
    StopSignal?: string;
    StopTimeout?: number | null;
    Healthcheck?: unknown;
    Volumes?: Record<string, unknown> | null;
  };
  HostConfig: {
    Binds?: string[] | null;
    NetworkMode?: string;
    PortBindings?: Record<string, DockerPortBinding[]> | null;
    RestartPolicy?: { Name: string; MaximumRetryCount: number };
    AutoRemove?: boolean;
    [key: string]: unknown;
  };
  NetworkSettings: {
    Networks?: Record<
      string,
      { Aliases?: string[] | null; IPAMConfig?: unknown } | null
    > | null;
  };
  Mounts?: DockerMount[] | null;
  State: {
    Status: string;
    Running: boolean;
    Restarting?: boolean;
    ExitCode: number;
    Health?: { Status: string };
  };
}

export interface DockerExecInspect {
  Running: boolean;
  ExitCode: number | null;
}

@Injectable()
export class DockerApiService {
  private readonly logger = new Logger(DockerApiService.name);

  constructor(private readonly updateConfig: UpdateConfigService) {}

  public getSocketPath(): string {
    return this.updateConfig.getDockerSocketPath();
  }

  /** GET /version, also used as "is the socket reachable" probe. */
  public async getVersion(timeoutMs = 5000): Promise<string> {
    const result = await this.request<{ Version: string }>(
      'GET',
      '/version',
      undefined,
      timeoutMs,
    );
    return result.Version;
  }

  public async inspectContainer(
    idOrName: string,
  ): Promise<DockerContainerInspect> {
    return this.request<DockerContainerInspect>(
      'GET',
      `/containers/${encodeURIComponent(idOrName)}/json`,
    );
  }

  public async listContainers(
    filters: Record<string, string[]>,
  ): Promise<DockerContainerSummary[]> {
    const query = encodeURIComponent(JSON.stringify(filters));
    return this.request<DockerContainerSummary[]>(
      'GET',
      `/containers/json?all=1&filters=${query}`,
    );
  }

  public async hasImage(imageRef: string): Promise<boolean> {
    try {
      await this.request(
        'GET',
        `/images/${encodeURIComponent(imageRef)}/json`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * POST /images/create: streams progress objects, the last one may hold an
   * error even though the HTTP status is 200.
   */
  public async pullImage(
    repository: string,
    tag: string,
    timeoutMs = 20 * 60 * 1000,
  ): Promise<void> {
    const path = `/images/create?fromImage=${encodeURIComponent(
      repository,
    )}&tag=${encodeURIComponent(tag)}`;

    this.logger.log(`Pulling ${repository}:${tag}`);

    await new Promise<void>((resolve, reject) => {
      let buffered = '';
      let lastStatus = '';
      let lastStatusLog = 0;
      let failure: string | null = null;
      let settled = false;

      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err !== undefined) reject(err);
        else resolve();
      };

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (trimmed === '') return;
        try {
          const parsed = JSON.parse(trimmed) as {
            status?: string;
            error?: string;
            errorDetail?: { message?: string };
          };
          if (parsed.error || parsed.errorDetail?.message) {
            failure =
              parsed.errorDetail?.message ??
              parsed.error ??
              'Unknown docker pull error';
            return;
          }
          if (parsed.status) {
            lastStatus = parsed.status;
            const now = Date.now();
            if (now - lastStatusLog > 15000) {
              lastStatusLog = now;
              this.logger.log(`Pull progress: ${lastStatus}`);
            }
          }
        } catch {
          // Progress streams are line delimited JSON, ignore anything weird.
        }
      };

      const req = httpRequest(
        {
          socketPath: this.getSocketPath(),
          path,
          method: 'POST',
          headers: { Host: 'docker', 'Content-Length': 0 },
          timeout: timeoutMs,
        },
        (rawResponse) => {
          const res = rawResponse as unknown as RawHttpResponse;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffered += chunk;
            let index = buffered.indexOf('\n');
            while (index !== -1) {
              handleLine(buffered.slice(0, index));
              buffered = buffered.slice(index + 1);
              index = buffered.indexOf('\n');
            }
          });
          res.on('end', () => {
            if (buffered !== '') handleLine(buffered);
            if (failure) {
              return finish(
                Fail(FT.Network, `Could not pull the new image: ${failure}`),
              );
            }
            if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
              return finish(
                Fail(
                  FT.Network,
                  `Could not pull the new image: docker answered with ${res.statusCode}`,
                ),
              );
            }
            finish();
          });
          res.on('error', (err) => {
            finish(
              Fail(
                FT.Network,
                `Could not pull the new image: ${err.message}`,
              ),
            );
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(
          new Error(`docker pull timed out after ${timeoutMs / 1000}s`),
        );
      });
      req.on('error', (err) => {
        finish(
          Fail(
            FT.Network,
            `Could not talk to the docker socket at ${this.getSocketPath()}: ${err.message}`,
          ),
        );
      });
      req.end();
    });
  }

  public async createContainer(
    name: string | undefined,
    config: unknown,
  ): Promise<string> {
    const path =
      name === undefined
        ? '/containers/create'
        : `/containers/create?name=${encodeURIComponent(name)}`;
    const result = await this.request<{ Id: string }>(
      'POST',
      path,
      config,
    );
    if (!result?.Id) {
      throw Fail(FT.Internal, 'Docker did not return a container id');
    }
    return result.Id;
  }

  public async startContainer(id: string): Promise<void> {
    await this.request('POST', `/containers/${encodeURIComponent(id)}/start`);
  }

  public async stopContainer(id: string, timeoutSeconds = 30): Promise<void> {
    await this.request(
      'POST',
      `/containers/${encodeURIComponent(id)}/stop?t=${timeoutSeconds}`,
      undefined,
      (timeoutSeconds + 30) * 1000,
    );
  }

  public async renameContainer(id: string, name: string): Promise<void> {
    await this.request(
      'POST',
      `/containers/${encodeURIComponent(id)}/rename?name=${encodeURIComponent(
        name,
      )}`,
    );
  }

  public async removeContainer(id: string, force = false): Promise<void> {
    await this.request(
      'DELETE',
      `/containers/${encodeURIComponent(id)}?force=${force}&v=0`,
    );
  }

  public async createExec(id: string, cmd: string[]): Promise<string> {
    const result = await this.request<{ Id: string }>(
      'POST',
      `/containers/${encodeURIComponent(id)}/exec`,
      { AttachStdout: false, AttachStderr: false, Cmd: cmd },
    );
    if (!result?.Id) throw Fail(FT.Internal, 'Docker did not return an exec id');
    return result.Id;
  }

  public async startExec(execId: string): Promise<void> {
    await this.request(
      'POST',
      `/exec/${encodeURIComponent(execId)}/start`,
      { Detach: true, Tty: false },
    );
  }

  public async inspectExec(execId: string): Promise<DockerExecInspect> {
    return this.request<DockerExecInspect>(
      'GET',
      `/exec/${encodeURIComponent(execId)}/json`,
    );
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload =
        body === undefined ? undefined : Buffer.from(JSON.stringify(body));

      const req = httpRequest(
        {
          socketPath: this.getSocketPath(),
          path,
          method,
          headers: {
            Host: 'docker',
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': String(payload.length) } : {}),
          },
          timeout: timeoutMs,
        },
        (res: RawHttpResponse) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;

            if (status >= 200 && status < 300) {
              if (text.trim() === '') {
                resolve(undefined as unknown as T);
                return;
              }
              try {
                resolve(JSON.parse(text) as T);
              } catch {
                resolve(text as unknown as T);
              }
              return;
            }

            reject(
              Fail(
                FT.Internal,
                `Docker API ${method} ${path} failed with ${status}: ${text.slice(
                  0,
                  300,
                )}`,
              ),
            );
          });
          res.on('error', (err) => {
            reject(
              Fail(FT.Network, `Docker answer failed: ${err.message}`),
            );
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`timed out after ${timeoutMs / 1000}s`));
      });
      req.on('error', (err) => {
        reject(
          Fail(
            FT.Network,
            `Could not talk to the docker socket at ${this.getSocketPath()}: ${err.message}`,
          ),
        );
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
