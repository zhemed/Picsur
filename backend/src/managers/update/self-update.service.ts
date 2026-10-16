import { Injectable, Logger } from '@nestjs/common';
import isDocker from 'is-docker';
import { existsSync, statSync } from 'node:fs';
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
const SelfLabel = 'picsur.update.self';
// The helper carries the id of the update "lineage" it belongs to. The id is
// created on the first self update of an instance and copied onto every
// replacement container, so it survives container recreation. It is what makes
// "show me *my* last update" possible on a host that runs several instances.
const OwnerLabel = 'picsur.update.owner';
const InstanceLabel = 'picsur.update.instance';

// Containers we park during a swap: <name>-prev-<ts> (the old one, renamed
// aside) and <name>-new-<ts> (the replacement before it takes over the name).
const PrevSuffix = /-prev-\d+$/;
const NewSuffix = /-new-\d+$/;

export interface UpdateStatusInfo {
  state: UpdateState;
  message: string | null;
}

export interface UpdatePlan {
  self: DockerContainerInspect;
  containerName: string;
  baseName: string;
  lineageId: string;
  helperName: string;
  rescueName: string;
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

function baseNameOf(name: string): string {
  return name.replace(PrevSuffix, '').replace(NewSuffix, '');
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
    // Only helpers that belong to *this* container lineage are considered: on a
    // host with several instances the others' helpers are none of our business.
    try {
      const self = await this.findSelfContainer();
      const lineage = this.lineageIdOf(self);

      const helpers = await this.docker.listContainers({
        label: [
          `${HelperLabel}=${HelperLabelValue}`,
          `${OwnerLabel}=${lineage}`,
        ],
      });
      if (helpers.length === 0) return { state: 'idle', message: null };

      const described = helpers.map((helper) => ({
        helper,
        name: containerNameFromInspect(helper.Names?.[0] ?? helper.Id),
      }));

      // How a swap ended is written into the helper's own name (see
      // update-helper.script.ts): -ok / -rolledback / -idle. A conclusive
      // outcome wins over a helper that is merely still running (the rescue
      // helper talks to the same job).
      const running = described.find((entry) => entry.helper.State === 'running');
      const concluded = described
        .filter(
          (entry) =>
            entry.name.endsWith('-ok') || entry.name.endsWith('-rolledback'),
        )
        .sort((a, b) => b.helper.Created - a.helper.Created)[0];

      if (concluded !== undefined) {
        if (concluded.name.endsWith('-rolledback')) {
          return {
            state: 'failed',
            message: `The last update failed and the previous version was restored. Details: docker logs ${concluded.name}`,
          };
        }
        return { state: 'success', message: null };
      }

      if (running !== undefined) return { state: 'running', message: null };

      const latest = described.sort(
        (a, b) => b.helper.Created - a.helper.Created,
      )[0];
      const inspect = await this.docker.inspectContainer(latest.helper.Id);

      if (inspect.State.Running) return { state: 'running', message: null };
      if (inspect.State.ExitCode === 0) {
        return { state: 'success', message: null };
      }
      return {
        state: 'failed',
        message: `The last update failed (exit code ${inspect.State.ExitCode}). Details: docker logs ${latest.name}`,
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

    // All-in-one image: it carries everything it needs, so the command can be
    // rebuilt from the real container config (name, ports, volumes, restart).
    if (env['PICSUR_DATA_DIR']) {
      return (
        `docker pull ${image} && docker rm -f ${name} && ` +
        `docker run -d ${this.buildRunArguments(self, image).join(' ')}`
      );
    }

    return `docker pull ${image}`;
  }

  /**
   * Rebuild the `docker run` flags of a container from its own configuration,
   * so the copy-paste command really recreates what is running (the earlier
   * version hardcoded 8080:8080 and --restart always).
   */
  private buildRunArguments(
    self: DockerContainerInspect,
    image: string,
  ): string[] {
    const args = ['--name', containerNameFromInspect(self.Name)];

    const restart = self.HostConfig.RestartPolicy;
    if (restart?.Name && restart.Name !== 'no') {
      const retries =
        restart.Name === 'on-failure' && restart.MaximumRetryCount > 0
          ? `:${restart.MaximumRetryCount}`
          : '';
      args.push('--restart', `${restart.Name}${retries}`);
    }

    for (const [containerPort, bindings] of Object.entries(
      self.HostConfig.PortBindings ?? {},
    )) {
      // Port keys look like "8080/tcp"; /tcp is the default protocol.
      const port = containerPort.replace(/\/tcp$/, '');
      for (const binding of bindings ?? []) {
        const hostIp = binding.HostIp ? `${binding.HostIp}:` : '';
        args.push('-p', `${hostIp}${binding.HostPort ?? ''}:${port}`);
      }
    }

    const seen = new Set<string>();
    for (const mount of self.Mounts ?? []) {
      if (!mount.Source || !mount.Destination) continue;
      const volume = `${mount.Source}:${mount.Destination}${
        mount.RW ? '' : ':ro'
      }`;
      if (seen.has(volume)) continue;
      seen.add(volume);
      args.push('-v', volume);
    }

    args.push(image);
    return args;
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

    const self = await this.findSelfContainer();
    const name = containerNameFromInspect(self.Name);
    const baseName = baseNameOf(name);

    await this.cleanupLeftovers(baseName);

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
      baseName,
      lineageId: this.lineageIdOf(self),
      helperName: `${name}-update-${stamp}`,
      rescueName: `${name}-rescue-${stamp}`,
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
    let helperId: string | null = null;
    try {
      await this.docker.pullImage(plan.repository, plan.tag);

      newContainerId = await this.docker.createContainer(
        plan.tempName,
        this.buildCreateConfig(plan, plan.imageRef),
      );
      this.logger.log(`Created replacement container ${newContainerId}`);

      helperId = await this.docker.createContainer(
        plan.helperName,
        this.buildHelperConfig(plan, newContainerId, 'primary'),
      );
      const rescueId = await this.docker.createContainer(
        plan.rescueName,
        this.buildHelperConfig(plan, newContainerId, 'rescue'),
      );
      await this.docker.startContainer(helperId);
      await this.docker.startContainer(rescueId);
      await this.waitForHelper(plan, helperId);

      this.logger.log(
        'Update helper is running, this container will be replaced now',
      );
      // From here the helper takes over. In the success path this process is
      // stopped long before the next lines would matter.
    } catch (error) {
      const message = IsFailure(error) ? error.getReason() : String(error);
      this.logger.error(`Self update could not be started: ${message}`);

      // The helper runs with `restart: on-failure`: it may simply be between
      // two runs. Never touch the containers while it can still be working.
      if (helperId !== null && (await this.isHelperAlive(helperId))) {
        if (await this.swapStarted(plan)) {
          this.logger.warn(
            `The update helper is still working (${plan.helperName}), leaving the swap to it`,
          );
          return;
        }

        // Nothing was touched yet (the old container still runs under its own
        // name): the helper is alive but unable to do its job. Report it and
        // release the lock instead of leaving the panel on "updating" forever.
        this.logger.error(
          `The update helper cannot start the swap (${plan.helperName}), giving up on this attempt`,
        );
        this.lastUpdate = {
          state: 'failed',
          message: `${message}. The update helper could not start the swap, the instance keeps running unchanged. Details: docker logs ${plan.helperName}`,
        };
        this.running = false;
        return;
      }

      if (newContainerId !== null) {
        await this.removeUntouchedReplacement(plan, newContainerId);
      }

      this.lastUpdate = { state: 'failed', message };
      this.running = false;
    }
  }

  /**
   * Did the swap actually touch anything? True as soon as the old container is
   * renamed aside, stopped or gone; false while it still runs under its own
   * name (then a broken helper did not change the world and we can give up).
   */
  private async swapStarted(plan: UpdatePlan): Promise<boolean> {
    try {
      const old = await this.docker.inspectContainer(plan.self.Id);
      const name = containerNameFromInspect(old.Name);
      return !(old.State.Running && name === plan.containerName);
    } catch {
      return true;
    }
  }

  private async isHelperAlive(helperId: string): Promise<boolean> {
    try {
      const inspect = await this.docker.inspectContainer(helperId);
      return inspect.State.Running === true || inspect.State.Restarting === true;
    } catch {
      return false;
    }
  }

  /**
   * Only remove the replacement while it is still untouched (not started, still
   * carrying its temporary name). Once the helper renamed/started it, it is the
   * live container and removing it would take the service down.
   */
  private async removeUntouchedReplacement(
    plan: UpdatePlan,
    newContainerId: string,
  ): Promise<void> {
    try {
      const inspect = await this.docker.inspectContainer(newContainerId);
      const name = containerNameFromInspect(inspect.Name);
      if (inspect.State.Running || name !== plan.tempName) {
        this.logger.warn(
          `Not removing ${name}: it is already in use, the update helper owns it now`,
        );
        return;
      }
      await this.docker.removeContainer(newContainerId, true);
      this.logger.log(`Removed the unused replacement container ${name}`);
    } catch (cleanupError) {
      this.logger.warn(
        `Could not clean up the temporary container: ${
          IsFailure(cleanupError)
            ? cleanupError.getReason()
            : String(cleanupError)
        }`,
      );
    }
  }

  private async waitForHelper(
    plan: UpdatePlan,
    helperId: string,
  ): Promise<void> {
    const deadline = Date.now() + 30000;
    let lastExitCode: number | null = null;

    while (Date.now() < deadline) {
      const inspect = await this.docker.inspectContainer(helperId);
      if (inspect.State.Running) return;
      if (inspect.State.Restarting) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      lastExitCode = inspect.State.ExitCode;
      // `restart: on-failure` brings it back, give docker a moment to do so.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw Fail(
      FT.Internal,
      `The update helper did not come up (last exit code ${lastExitCode}). Logs: docker logs ${plan.helperName}`,
    );
  }

  /** Remove leftovers of *this* container lineage (old swaps, old helpers). */
  private async cleanupLeftovers(baseName: string): Promise<void> {
    try {
      for (const container of await this.listLineageContainers(baseName)) {
        const leftoverName = containerNameFromInspect(
          container.Names?.[0] ?? container.Id,
        );
        if (leftoverName === baseName) continue;
        if (container.State === 'running') {
          this.logger.warn(
            `Not touching the running leftover container ${leftoverName}`,
          );
          continue;
        }
        await this.docker.removeContainer(container.Id, true);
        this.logger.log(`Removed leftover container ${leftoverName}`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not clean up leftover containers: ${
          IsFailure(error) ? error.getReason() : String(error)
        }`,
      );
    }

    try {
      const lineage = await this.findSelfContainer().then((self) =>
        this.lineageIdOf(self),
      );
      const helpers = await this.docker.listContainers({
        label: [
          `${HelperLabel}=${HelperLabelValue}`,
          `${OwnerLabel}=${lineage}`,
        ],
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

  /**
   * Best effort repair of a swap that was interrupted (helper killed, daemon
   * restarted, host rebooted). Two shapes are handled:
   *
   *  - this process runs as <name>-prev-<ts>: the previous container was
   *    started again by hand. Delete the abandoned replacement, take the
   *    canonical name back and report it.
   *  - this process runs as <name>: the replacement came up but the helper died
   *    before it removed the old container. Delete the stopped leftovers.
   */
  public async selfHealOnStartup(): Promise<void> {
    if (!this.updateConfig.isSelfUpdateEnabled()) return;

    try {
      await this.docker.getVersion(5000);
    } catch {
      // No usable docker socket: nothing to heal (and nothing was swapped).
      return;
    }

    try {
      const self = await this.findSelfContainer();
      await this.recoverInterruptedUpdate(self);
    } catch (error) {
      this.logger.warn(
        `Update self healing failed: ${
          IsFailure(error) ? error.getReason() : String(error)
        }`,
      );
    }
  }

  private async recoverInterruptedUpdate(
    self: DockerContainerInspect,
  ): Promise<void> {
    const myName = containerNameFromInspect(self.Name);
    const baseName = baseNameOf(myName);
    const containers = await this.listLineageContainers(baseName);

    const removed: string[] = [];
    for (const container of containers) {
      if (container.Id === self.Id) continue;
      const leftoverName = containerNameFromInspect(
        container.Names?.[0] ?? container.Id,
      );
      if (container.State === 'running') {
        this.logger.warn(
          `Found a running container ${leftoverName} that belongs to an interrupted update, leaving it alone`,
        );
        continue;
      }
      await this.docker.removeContainer(container.Id, true);
      removed.push(leftoverName);
      this.logger.warn(
        `Removed leftover container ${leftoverName} (interrupted update)`,
      );
    }

    if (myName !== baseName) {
      // We are the old container that was started again: give the deployment
      // its name back, otherwise nothing (compose, monitoring, the next update)
      // can find it any more.
      const nameTaken = containers.some(
        (container) =>
          container.Id !== self.Id &&
          container.Names?.some((n) => n === `/${baseName}`),
      );
      if (nameTaken) {
        this.logger.warn(
          `Cannot rename ${myName} back to ${baseName}: the name is still in use`,
        );
      } else {
        await this.docker.renameContainer(self.Id, baseName);
        this.logger.warn(
          `Recovered from an interrupted update: renamed ${myName} back to ${baseName}`,
        );
      }
      this.lastUpdate = {
        state: 'failed',
        message:
          `The previous update was interrupted, this instance was restored from ${myName}.` +
          (removed.length > 0
            ? ` Removed leftovers: ${removed.join(', ')}.`
            : ''),
      };
      return;
    }

    if (removed.length > 0) {
      this.lastUpdate = {
        state: 'success',
        message:
          `The last update finished, the update helper did not clean up: removed ${removed.join(', ')} on startup.`,
      };
    }
  }

  /** Containers that can only come from this instance: <base> and its swaps. */
  private async listLineageContainers(baseName: string) {
    const all = await this.docker.listContainers({});
    const prefixPrev = `/${baseName}-prev-`;
    const prefixNew = `/${baseName}-new-`;
    return all.filter(
      (container) =>
        container.Names?.some(
          (n) =>
            n === `/${baseName}` ||
            n.startsWith(prefixPrev) ||
            n.startsWith(prefixNew),
        ) ?? false,
    );
  }

  /** Stable id across container recreation, used to tell our helpers apart. */
  private lineageIdOf(self: DockerContainerInspect): string {
    return self.Config.Labels?.[InstanceLabel] ?? self.Id;
  }

  private async resolveTarget(
    ownImage: string,
    tagOverride?: string,
  ): Promise<{ repository: string; tag: string }> {
    const override = this.updateConfig.getImageOverride();
    const own = splitImageRef(ownImage);
    const parsed = splitImageRef(override ?? ownImage);

    const explicit = tagOverride ?? this.updateConfig.getTagOverride();

    // A variant tag (our "allinone" is published as another tag of the same
    // repository) must be preserved: replacing it with the plain version tag
    // swaps in the regular image, which cannot start as an all-in-one
    // deployment (different entrypoint). Re-pull the very tag we run; the
    // release pipeline keeps moving it to the newest build.
    const isVariableTag = (tag: string): boolean =>
      tag !== '' && tag !== 'latest' && !/^v?\d+(\.\d+)*$/.test(tag);
    if (override === undefined && isVariableTag(own.tag)) {
      if (explicit !== undefined && explicit !== '' && explicit !== own.tag) {
        this.logger.warn(
          `PICSUR_UPDATE_TAG="${explicit}" is ignored on purpose: this deployment runs the "${own.tag}" variant tag of ${own.repository}, ` +
            `which is the image this deployment has to keep (the plain version tags are a different image and cannot start here). ` +
            `Use PICSUR_UPDATE_IMAGE=<repo>:<tag> to override the image completely.`,
        );
      }
      return { repository: own.repository, tag: own.tag };
    }

    let tag = parsed.tag;
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

  /**
   * GID of the docker socket, as seen from inside this container.
   *
   * The socket is `root:docker 0660` on the host. The app container gets access
   * through compose's `group_add`, but containers we create ourselves through
   * the API (the update helper and the replacement) do not inherit that - and
   * since 0.8.0 the regular image runs as the unprivileged `node` user, so
   * without that group the helper cannot even talk to the socket. A bind mount
   * keeps the host's numeric gid, so stat() inside the container is enough.
   */
  private socketGroupId(): number | null {
    const socketPath = this.docker.getSocketPath();
    try {
      return statSync(socketPath).gid;
    } catch (error) {
      this.logger.warn(
        `Could not read the group of the docker socket (${socketPath}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Existing groups plus the socket gid (the helper/replacement need it). */
  private withSocketGroup(
    existing: string[] | undefined,
    socketGid: number | null,
  ): string[] | undefined {
    const groups = [...(existing ?? [])];
    if (socketGid !== null && !groups.includes(String(socketGid))) {
      groups.push(String(socketGid));
    }
    return groups.length > 0 ? groups : undefined;
  }

  private buildCreateConfig(plan: UpdatePlan, image: string): unknown {
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

    // The replacement inherits the socket mount; if the *new* image runs as a
    // non-root user (0.8.0+ does), it needs the socket's group as well, or the
    // panel loses the ability to update itself. Harmless for root containers.
    const socketGroups = this.withSocketGroup(
      hostConfig['GroupAdd'] as string[] | undefined,
      this.socketGroupId(),
    );
    if (socketGroups !== undefined) hostConfig['GroupAdd'] = socketGroups;

    const labels: Record<string, string> = {
      ...(self.Config.Labels ?? {}),
      [SelfLabel]: 'true',
      // Kept across recreations: it is how the replacement recognises the
      // helpers that belong to this instance instead of to a neighbour.
      [InstanceLabel]: plan.lineageId,
    };

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
    role: 'primary' | 'rescue',
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
      role,
      peerName: role === 'primary' ? plan.rescueName : plan.helperName,
      takeoverDelayMs: 8000,
      rescueWaitMs: 240000,
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

    const socketGid = this.socketGroupId();
    const helperGroups = this.withSocketGroup(undefined, socketGid);
    if (helperGroups === undefined) {
      // No usable gid: the only way the helper can still reach the socket is
      // root. Runs in a container that already has the socket, so this does not
      // widen the blast radius - but it only happens when we cannot do better.
      this.logger.warn(
        'Could not determine the docker socket group; running the update helper as root so the upgrade can still work',
      );
    }

    return {
      // Run the helper from the image we are currently running: it is known to
      // work, the new image is not trusted until it answered its health probe.
      Image: plan.self.Config.Image,
      // Unset = the image's own user (0.8.0+ runs as `node`). The helper talks
      // to the socket, so it needs the same group access the app container has.
      User: helperGroups === undefined ? '0' : undefined,
      Entrypoint: ['node'],
      Cmd: ['-e', UpdateHelperScript],
      Env: [`PICSUR_UPDATE_JOB=${JSON.stringify(job)}`],
      WorkingDir: '/',
      Labels: {
        [HelperLabel]: HelperLabelValue,
        [OwnerLabel]: plan.lineageId,
        'picsur.update.role': role,
        'picsur.update.image': plan.imageRef,
      },
      HostConfig: {
        Binds: [plan.socketBind],
        ...(helperGroups !== undefined ? { GroupAdd: helperGroups } : {}),
        AutoRemove: false,
        // The helper is the only actor during the swap window. If it dies
        // (kill / OOM / docker daemon restart) docker has to bring it back,
        // otherwise the instance can stay down with the old container stopped.
        // The script is written to be re-runnable for exactly this reason.
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
        LogConfig: { Type: 'json-file', Config: {} },
      },
    };
  }
}
