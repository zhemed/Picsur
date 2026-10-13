import { Injectable, Logger } from '@nestjs/common';
import isDocker from 'is-docker';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { UpdateState } from 'picsur-shared/dist/dto/api/update.dto';
import { Fail, FT, IsFailure } from 'picsur-shared/dist/types/failable';
import { UpdateConfigService } from '../../config/late/update.config.service.js';
import {
    DockerApiService,
    DockerContainerInspect,
    DockerMount,
} from './docker-api.service.js';
import { UpdateCheckService } from './update-check.service.js';
import { UpdateHelperScript } from './update-helper.script.js';

const HelperLabel = 'picsur.update';
const HelperLabelValue = 'helper';
const TempLabel = 'picsur.update.temp';
const SelfLabel = 'picsur.update.self';

export interface UpdateStatusInfo {
  state: UpdateState;
  message: string | null;
}

export interface UpdatePlan {
  self: DockerContainerInspect;
  containerName: string;
  helperName: string;
  tempName: string;
  repository: string;
  tag: string;
  imageRef: string;
  appPort: number;
  socketBind: string;
}

function splitImageRef(ref: string): { repository: string; tag: string } {
  const withoutDigest = ref.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return {
      repository: withoutDigest.slice(0, lastColon),
      tag: withoutDigest.slice(lastColon + 1),
    };
  }
  return { repository: withoutDigest, tag: 'latest' };
}

function envToMap(env: string[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of env ?? []) {
    const index = entry.indexOf('=');
    if (index === -1) continue;
    map[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return map;
}

function containerNameFromInspect(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name;
}

/**
 * Recreates this container from a freshly pulled image.
 *
 * The actual swap is done by a helper container (see update-helper.script.ts),
 * because this process lives inside the container that has to be stopped.
 */
@Injectable()
export class SelfUpdateService {
  private readonly logger = new Logger(SelfUpdateService.name);

  private running = false;
  private beginTimer: NodeJS.Timeout | null = null;
  private lastUpdate: UpdateStatusInfo | null = null;

  constructor(
    private readonly updateConfig: UpdateConfigService,
    private readonly docker: DockerApiService,
    private readonly check: UpdateCheckService,
  ) {}

  public isRunning(): boolean {
    return this.running;
  }

  /** State shown in the panel: running / last result. */
  public async getStatus(): Promise<UpdateStatusInfo> {
    if (this.running) return { state: 'running', message: null };
    if (this.lastUpdate !== null) return this.lastUpdate;

    if (!this.updateConfig.isSelfUpdateEnabled()) {
      return { state: 'idle', message: null };
    }

    // After a handoff the process that started the update is gone, so the only
    // way to know how it went is looking at the helper container it left behind.
    try {
      const helpers = await this.docker.listContainers({
        label: [`${HelperLabel}=${HelperLabelValue}`],
      });
      if (helpers.length === 0) return { state: 'idle', message: null };

      helpers.sort((a, b) => b.Created - a.Created);
      const latest = helpers[0];
      const inspect = await this.docker.inspectContainer(latest.Id);

      if (inspect.State.Running) return { state: 'running', message: null };
      if (inspect.State.ExitCode === 0) {
        return { state: 'success', message: null };
      }
      return {
        state: 'failed',
        message: `The last update failed (exit code ${inspect.State.ExitCode}). Details: docker logs ${containerNameFromInspect(latest.Names?.[0] ?? latest.Id)}`,
      };
    } catch {
      // No docker socket / no permission: no update state to report.
      return { state: 'idle', message: null };
    }
  }

  /** Command shown in the panel when self updating is not available. */
  public async getManualCommand(): Promise<string> {
    const override = this.updateConfig.getCommandOverride();
    if (override) return override;

    const defaultImage = 'ghcr.io/zhemed/picsur:latest';
    const allInOneDefault =
      `docker pull ${defaultImage} && docker rm -f picsur && ` +
      `docker run -d --name picsur --restart always -p 8080:8080 ` +
      `-v ./data:/data ${defaultImage}`;

    let self: DockerContainerInspect;
    try {
      self = await this.findSelfContainer();
    } catch {
      return allInOneDefault;
    }

    const labels = self.Config.Labels ?? {};
    const name = containerNameFromInspect(self.Name);

    const workingDir = labels['com.docker.compose.project.working_dir'];
    const composeFile = labels['com.docker.compose.project.config_files'];
    if (workingDir) {
      const fileArg =
        composeFile && !composeFile.includes(',') ? ` -f ${composeFile}` : '';
      return `cd ${workingDir} && docker compose${fileArg} pull && docker compose${fileArg} up -d`;
    }

    const env = envToMap(self.Config.Env);
    const image = this.updateConfig.getImageOverride() ?? self.Config.Image;

    // All-in-one image: everything it needs is its name, port and /data volume.
    if (env['PICSUR_DATA_DIR']) {
      const dataDir = env['PICSUR_DATA_DIR'];
      const mount = (self.Mounts ?? []).find((m) => m.Destination === dataDir);
      const hostPath = mount?.Source ?? dataDir;
      const port = env['PICSUR_PORT'] ?? '8080';
      const restartPolicy = self.HostConfig.RestartPolicy?.Name;
      const restart =
        restartPolicy && restartPolicy !== 'no' ? restartPolicy : 'always';
      return (
        `docker pull ${image} && docker rm -f ${name} && ` +
        `docker run -d --name ${name} --restart ${restart} ` +
        `-p ${port}:${port} -v ${hostPath}:${dataDir} ${image}`
      );
    }

    return `docker pull ${image}`;
  }

  /**
   * Everything that can (and should) fail before anything is touched.
   * Throws a Failure the API can return to the admin.
   */
  public async prepare(tagOverride?: string): Promise<UpdatePlan> {
    if (!this.updateConfig.isSelfUpdateEnabled()) {
      throw Fail(
        FT.Permission,
        'Self update is disabled. Set PICSUR_ALLOW_SELF_UPDATE=true and mount the docker socket into this container to enable it.',
      );
    }

    if (this.running) {
      throw Fail(FT.Conflict, 'An update is already running');
    }

    // Take the lock here, not in begin(): two parallel POSTs would both pass
    // the check above before either of them reaches begin().
    this.running = true;
    try {
      return await this.prepareLocked(tagOverride);
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  private async prepareLocked(tagOverride?: string): Promise<UpdatePlan> {
    try {
      await this.docker.getVersion(5000);
    } catch (error) {
      const reason = IsFailure(error) ? error.getReason() : String(error);
      throw Fail(
        FT.Network,
        `Self update is enabled, but the docker socket is not usable (${this.docker.getSocketPath()}): ${reason}`,
      );
    }

    await this.cleanupLeftovers();

    const self = await this.findSelfContainer();
    const name = containerNameFromInspect(self.Name);

    if (self.HostConfig.AutoRemove === true) {
      throw Fail(
        FT.Impossible,
        'This container was started with --rm, it can not be recreated safely',
      );
    }

    const networkMode = self.HostConfig.NetworkMode ?? '';
    if (networkMode.startsWith('container:')) {
      throw Fail(
        FT.Impossible,
        'This container shares the network namespace of another container, it can not be recreated safely',
      );
    }

    const socketBind = this.resolveSocketBind(self);
    const { repository, tag } = await this.resolveTarget(
      self.Config.Image,
      tagOverride,
    );

    const env = envToMap(self.Config.Env);
    const appPort = Number(env['PICSUR_PORT'] ?? 8080) || 8080;

    const stamp = Date.now();

    // Safety net: if the response never reaches the client, begin() is never
    // called and the lock would stay forever (until restart).
    this.beginTimer = setTimeout(() => {
      if (this.beginTimer === null) return;
      this.beginTimer = null;
      this.running = false;
      this.logger.warn(
        'The update was prepared but never started (response did not finish), lock released',
      );
    }, 120000);
    this.beginTimer.unref?.();

    return {
      self,
      containerName: name,
      helperName: `${name}-update-${stamp}`,
      tempName: `${name}-new-${stamp}`,
      repository,
      tag,
      imageRef: `${repository}:${tag}`,
      appPort,
      socketBind,
    };
  }

  /**
   * The actual update. Runs after the HTTP response was sent, the container
   * this process lives in may be stopped at any moment from here on.
   */
  public async begin(plan: UpdatePlan): Promise<void> {
    if (this.beginTimer !== null) {
      clearTimeout(this.beginTimer);
      this.beginTimer = null;
    }
    this.logger.log(
      `Self update starting: ${plan.imageRef} (container ${plan.containerName})`,
    );

    let newContainerId: string | null = null;
    try {
      await this.docker.pullImage(plan.repository, plan.tag);

      newContainerId = await this.docker.createContainer(
        plan.tempName,
        this.buildCreateConfig(plan, plan.imageRef, true),
      );
      this.logger.log(`Created replacement container ${newContainerId}`);

      const helperId = await this.docker.createContainer(
        plan.helperName,
        this.buildHelperConfig(plan, newContainerId),
      );
      await this.docker.startContainer(helperId);
      await this.waitForHelper(plan, helperId);

      this.logger.log(
        'Update helper is running, this container will be replaced now',
      );
      // From here the helper takes over. In the success path this process is
      // stopped long before the next lines would matter.
    } catch (error) {
      const message = IsFailure(error) ? error.getReason() : String(error);
      this.logger.error(`Self update could not be started: ${message}`);

      if (newContainerId !== null) {
        await this.docker
          .removeContainer(newContainerId, true)
          .catch((cleanupError) =>
            this.logger.warn(
              `Could not clean up the temporary container: ${
                IsFailure(cleanupError)
                  ? cleanupError.getReason()
                  : String(cleanupError)
              }`,
            ),
          );
      }

      this.lastUpdate = { state: 'failed', message };
      this.running = false;
    }
  }

  private async waitForHelper(
    plan: UpdatePlan,
    helperId: string,
  ): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const inspect = await this.docker.inspectContainer(helperId);
      if (inspect.State.Running) return;
      if (inspect.State.ExitCode !== 0) {
        throw Fail(
          FT.Internal,
          `The update helper exited immediately (exit code ${inspect.State.ExitCode}), nothing was changed. Logs: docker logs ${plan.helperName}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Fail(
      FT.Internal,
      `The update helper did not start in time. Logs: docker logs ${plan.helperName}`,
    );
  }

  /** Remove leftovers from earlier runs (temp containers, old helpers). */
  private async cleanupLeftovers(): Promise<void> {
    try {
      const temps = await this.docker.listContainers({ label: [TempLabel] });
      for (const container of temps) {
        if (container.State === 'running') continue;
        await this.docker.removeContainer(container.Id, true);
        this.logger.log(`Removed leftover container ${container.Id}`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not clean up leftover containers: ${
          IsFailure(error) ? error.getReason() : String(error)
        }`,
      );
    }

    try {
      const helpers = await this.docker.listContainers({
        label: [`${HelperLabel}=${HelperLabelValue}`],
      });
      const cutoff = Math.floor(Date.now() / 1000) - 6 * 60 * 60;
      for (const container of helpers) {
        if (container.State === 'running') continue;
        if (container.Created > cutoff) continue;
        await this.docker.removeContainer(container.Id, false);
        this.logger.log(`Removed old update helper ${container.Id}`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not clean up old update helpers: ${
          IsFailure(error) ? error.getReason() : String(error)
        }`,
      );
    }
  }

  private async resolveTarget(
    ownImage: string,
    tagOverride?: string,
  ): Promise<{ repository: string; tag: string }> {
    const override = this.updateConfig.getImageOverride();
    const parsed = splitImageRef(override ?? ownImage);

    let tag = parsed.tag;
    const explicit = tagOverride ?? this.updateConfig.getTagOverride();
    if (explicit !== undefined && explicit !== '') {
      tag = explicit;
    } else if (override === undefined) {
      // Default: use the newest known version tag, so we deploy exactly the
      // version the panel announced. Falls back to :latest when unknown.
      tag = this.check.getCachedLatest() ?? 'latest';
    }

    return { repository: parsed.repository, tag };
  }

  private async findSelfContainer(): Promise<DockerContainerInspect> {
    if (!isDocker()) {
      // Running from a plain host process (local development): there is no
      // container to recreate, and guessing one would be dangerous.
      throw Fail(
        FT.Impossible,
        'This instance does not run inside a container, there is nothing to recreate',
      );
    }

    const candidates = [
      process.env['PICSUR_UPDATE_CONTAINER'],
      hostname(),
      process.env['HOSTNAME'],
    ].filter((value): value is string => !!value);

    for (const candidate of candidates) {
      try {
        return await this.docker.inspectContainer(candidate);
      } catch {
        // try the next candidate
      }
    }

    // After an update the hostname changed, but the label we set survives.
    try {
      const found = await this.docker.listContainers({
        label: [`${SelfLabel}=true`],
      });
      if (found.length > 0) {
        found.sort((a, b) => b.Created - a.Created);
        return await this.docker.inspectContainer(found[0].Id);
      }
    } catch {
      // fall through to the error below
    }

    throw Fail(
      FT.Impossible,
      'Could not find the container this service runs in through the docker socket',
    );
  }

  private resolveSocketBind(self: DockerContainerInspect): string {
    const socketPath = this.docker.getSocketPath();

    const mount = (self.Mounts ?? []).find(
      (item: DockerMount) =>
        item.Type === 'bind' && item.Destination === socketPath,
    );
    if (mount) {
      return `${mount.Source}:${socketPath}${mount.RW ? '' : ':ro'}`;
    }

    for (const bind of self.HostConfig.Binds ?? []) {
      const parts = bind.split(':');
      if (parts.length >= 2 && parts[1] === socketPath) return bind;
    }

    if (existsSync(socketPath)) return `${socketPath}:${socketPath}`;

    throw Fail(
      FT.Impossible,
      `The docker socket (${socketPath}) is not mounted into this container, self update is not possible`,
    );
  }

  private buildCreateConfig(
    plan: UpdatePlan,
    image: string,
    isReplacement: boolean,
  ): unknown {
    const self = plan.self;
    const hostConfigKeys = [
      'Binds',
      'PortBindings',
      'PublishAllPorts',
      'RestartPolicy',
      'NetworkMode',
      'Privileged',
      'CapAdd',
      'CapDrop',
      'Devices',
      'DeviceRequests',
      'Dns',
      'DnsOptions',
      'DnsSearch',
      'ExtraHosts',
      'GroupAdd',
      'IpcMode',
      'PidMode',
      'ReadonlyRootfs',
      'ReadonlyPaths',
      'MaskedPaths',
      'SecurityOpt',
      'ShmSize',
      'Sysctls',
      'Tmpfs',
      'Ulimits',
      'LogConfig',
      'Init',
      'Runtime',
      'Memory',
      'MemorySwap',
      'MemoryReservation',
      'NanoCpus',
      'CpuShares',
      'CpuPeriod',
      'CpuQuota',
      'CpusetCpus',
      'CpusetMems',
      'BlkioWeight',
      'CgroupParent',
      'UsernsMode',
      'OomScoreAdj',
      'PidsLimit',
      'StorageOpt',
      'Isolation',
      'Platform',
    ] as const;

    const hostConfig: Record<string, unknown> = {};
    for (const key of hostConfigKeys) {
      const value = self.HostConfig[key];
      if (value !== undefined && value !== null) hostConfig[key] = value;
    }
    // Never let the replacement delete itself when it exits.
    hostConfig['AutoRemove'] = false;

    const binds = [...((hostConfig['Binds'] as string[] | undefined) ?? [])];
    for (const mountItem of self.Mounts ?? []) {
      if (mountItem.Type !== 'volume' || !mountItem.Name) continue;
      const alreadyBound = binds.some(
        (bind) => bind.split(':')[1] === mountItem.Destination,
      );
      if (!alreadyBound) {
        binds.push(
          `${mountItem.Name}:${mountItem.Destination}${
            mountItem.RW ? '' : ':ro'
          }`,
        );
      }
    }
    if (binds.length > 0) hostConfig['Binds'] = binds;

    const labels: Record<string, string> = {
      ...(self.Config.Labels ?? {}),
      [SelfLabel]: 'true',
    };
    if (isReplacement) labels[TempLabel] = 'true';

    const networks = self.NetworkSettings?.Networks ?? {};
    const endpoints: Record<string, unknown> = {};
    for (const [networkName, network] of Object.entries(networks)) {
      endpoints[networkName] = {
        ...(networkName !== 'bridge' && network?.Aliases
          ? { Aliases: network.Aliases }
          : {}),
        ...(network?.IPAMConfig ? { IPAMConfig: network.IPAMConfig } : {}),
      };
    }

    return {
      // Hostname is intentionally not copied: the replacement must be able to
      // find itself through its own hostname (= short container id) again.
      Image: image,
      User: self.Config.User,
      Env: self.Config.Env,
      Cmd: self.Config.Cmd,
      Entrypoint: self.Config.Entrypoint,
      WorkingDir: self.Config.WorkingDir,
      Labels: labels,
      StopSignal: self.Config.StopSignal,
      StopTimeout: self.Config.StopTimeout ?? undefined,
      Healthcheck: self.Config.Healthcheck ?? undefined,
      ExposedPorts: self.Config.ExposedPorts ?? undefined,
      HostConfig: hostConfig,
      ...(Object.keys(endpoints).length > 0
        ? { NetworkingConfig: { EndpointsConfig: endpoints } }
        : {}),
    };
  }

  private buildHelperConfig(
    plan: UpdatePlan,
    newContainerId: string,
  ): unknown {
    const expectedVersion = /^\d+\.\d+\.\d+$/.test(plan.tag) ? plan.tag : null;

    const probeScript = [
      `fetch('http://127.0.0.1:${plan.appPort}/api/info')`,
      `.then((r) => r.json())`,
      `.then((body) => {`,
      `  const version = body && body.data ? body.data.version : null;`,
      `  if (!version) { console.log('no version in /api/info'); process.exit(2); }`,
      `  const expected = ${JSON.stringify(expectedVersion)};`,
      `  if (expected !== null && version !== expected) {`,
      `    console.log('running version ' + version + ', expected ' + expected);`,
      `    process.exit(3);`,
      `  }`,
      `  console.log('healthy, version ' + version);`,
      `  process.exit(0);`,
      `})`,
      `.catch((err) => { console.log('probe failed: ' + err); process.exit(1); })`,
    ].join('');

    const job = {
      socketPath: this.docker.getSocketPath(),
      oldId: plan.self.Id,
      oldName: plan.containerName,
      oldNameAside: `${plan.containerName}-prev-${Date.now()}`,
      newId: newContainerId,
      image: plan.imageRef,
      probeCmd: ['node', '-e', probeScript],
      probeTimeoutMs: 120000,
      stopTimeoutSec: 30,
      graceMs: 1500,
      apiTimeoutMs: 120000,
    };

    return {
      // Run the helper from the image we are currently running: it is known to
      // work, the new image is not trusted until it answered its health probe.
      Image: plan.self.Config.Image,
      Entrypoint: ['node'],
      Cmd: ['-e', UpdateHelperScript],
      Env: [`PICSUR_UPDATE_JOB=${JSON.stringify(job)}`],
      WorkingDir: '/',
      Labels: {
        [HelperLabel]: HelperLabelValue,
        'picsur.update.image': plan.imageRef,
      },
      HostConfig: {
        Binds: [plan.socketBind],
        AutoRemove: false,
        RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
        LogConfig: { Type: 'json-file', Config: {} },
      },
    };
  }
}
