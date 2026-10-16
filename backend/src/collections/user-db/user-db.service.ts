import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt-ts';
import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
  HasSuccess,
} from 'picsur-shared/dist/types/failable';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { makeUnique } from 'picsur-shared/dist/util/unique';
import { Repository } from 'typeorm';
import { EUserBackend } from '../../database/entities/users/user.entity.js';
import {
  Permissions,
} from '../../models/constants/permissions.const.js';
import {
  ImplicitPermissions,
  SuperUserPermissions,
} from '../../models/constants/permission-templates.const.js';
import {
  ImmutableUsersList,
  LockedLoginUsersList,
  UndeletableUsersList,
} from '../../models/constants/special-users.const.js';
import { GetCols } from '../../util/collection.js';
import { SysPreferenceDbService } from '../preference-db/sys-preference-db.service.js';

@Injectable()
export class UserDbService {
  private readonly logger = new Logger(UserDbService.name);

  constructor(
    @InjectRepository(EUserBackend)
    private readonly usersRepository: Repository<EUserBackend>,
    private readonly prefService: SysPreferenceDbService,
  ) {}

  // Creation and deletion

  /**
   * Creates a user.
   *
   * New accounts start with **no** permissions (default deny); the admin picks
   * a template or ticks permissions in the user page. The built-in accounts
   * (`guest`, `admin`) get their sets from `UserDbModule`.
   *
   * The legacy `roles` column is left at its default and never written again -
   * it is kept frozen so a rollback to the previous release still works.
   */
  public async create(
    username: string,
    password: string,
    permissions: Permissions = [],
  ): AsyncFailable<EUserBackend> {
    if (await this.exists(username))
      return Fail(FT.Conflict, 'User already exists');

    const strength = await this.getBCryptStrength();
    const hashedPassword = await bcrypt.hash(password, strength);

    const user = new EUserBackend();
    user.username = username;
    user.hashed_password = hashedPassword;
    user.permissions = makeUnique(permissions);
    // The legacy column is NOT NULL without a database default: keep writing an
    // empty array so inserts stay valid (and a rollback sees "no roles").
    user.roles = [];

    try {
      return await this.usersRepository.save(user);
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async delete(uuid: string): AsyncFailable<EUserBackend> {
    const userToDelete = await this.findOne(uuid);
    if (HasFailed(userToDelete)) return userToDelete;

    if (UndeletableUsersList.includes(userToDelete.username)) {
      return Fail(FT.Permission, 'Cannot delete system user');
    }

    try {
      return await this.usersRepository.remove(userToDelete);
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Updating

  /**
   * Replaces the permissions of a user.
   *
   * The reserved `admin` account cannot be changed: it always has every
   * permission (see `getPermissions`), so accepting the change would be a lie.
   * It used to fail silently, which looked like a successful save in the UI.
   */
  public async setPermissions(
    uuid: string,
    permissions: Permissions,
  ): AsyncFailable<EUserBackend> {
    const userToModify = await this.findOne(uuid);
    if (HasFailed(userToModify)) return userToModify;

    if (ImmutableUsersList.includes(userToModify.username)) {
      return Fail(
        FT.Permission,
        `The built-in ${userToModify.username} account always has all permissions`,
      );
    }

    // Implicit permissions are granted at check time; storing them would only
    // make the picker lie about what is really editable.
    userToModify.permissions = makeUnique(
      permissions.filter((permission) => !ImplicitPermissions.includes(permission)),
    );

    try {
      return await this.usersRepository.save(userToModify);
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  /**
   * System-only variant of `setPermissions` (seeding, demo mode).
   *
   * Skips the built-in-account guard on purpose: `UserDbModule` owns the guest
   * account and has to be able to keep it in sync with the demo aware template.
   */
  public async forceSetPermissions(
    uuid: string,
    permissions: Permissions,
  ): AsyncFailable<EUserBackend> {
    const userToModify = await this.findOne(uuid);
    if (HasFailed(userToModify)) return userToModify;

    userToModify.permissions = makeUnique(permissions);

    try {
      return await this.usersRepository.save(userToModify);
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  /**
   * The permissions a request made by this user has.
   *
   * - the reserved `admin` account always gets everything (computed here, not
   *   stored, so new permissions do not need a migration and the owner cannot
   *   lock themselves out);
   * - every account additionally gets the implicit permissions (login,
   *   keep-login, settings);
   * - the rest is whatever is stored on the user.
   */
  public async getPermissions(uuid: string): AsyncFailable<Permissions> {
    const user = await this.findOne(uuid);
    if (HasFailed(user)) return user;

    if (ImmutableUsersList.includes(user.username)) return SuperUserPermissions;

    return makeUnique([
      ...ImplicitPermissions,
      ...(user.permissions ?? []),
    ]) as Permissions;
  }

  public async updatePassword(
    uuid: string,
    password: string,
  ): AsyncFailable<EUserBackend> {
    let userToModify = await this.findOne(uuid);
    if (HasFailed(userToModify)) return userToModify;

    const strength = await this.getBCryptStrength();
    userToModify.hashed_password = await bcrypt.hash(password, strength);

    try {
      userToModify = await this.usersRepository.save(userToModify);
    } catch (e) {
      return Fail(FT.Database, e);
    }

    return userToModify;
  }

  // Authentication

  async authenticate(
    username: string,
    password: string,
  ): AsyncFailable<EUserBackend> {
    const user = await this.findByUsername(username, true);
    if (HasFailed(user)) {
      if (user.getType() === FT.NotFound)
        return Fail(
          FT.Authentication,
          'Wrong username or password',
          user.getDebugMessage(),
        );
      else return user;
    }

    if (LockedLoginUsersList.includes(user.username)) {
      // Error should be kept in backend
      return Fail(FT.Authentication, 'Wrong username or password');
    }

    if (!(await bcrypt.compare(password, user.hashed_password ?? '')))
      return Fail(FT.Authentication, 'Wrong username or password');

    return await this.findOne(user.id ?? '');
  }

  // Listing

  public async checkUsername(username: string): AsyncFailable<{
    available: boolean;
  }> {
    try {
      const found = await this.usersRepository.findOne({
        where: { username },
        select: ['id'],
      });

      return { available: !found };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findByUsername(
    username: string,
    // Also fetch fields that aren't normally sent to the client
    // (e.g. hashed password)
    getPrivate = false,
  ): AsyncFailable<EUserBackend> {
    try {
      const found = await this.usersRepository.findOne({
        where: { username },
        select: getPrivate ? GetCols(this.usersRepository) : undefined,
      });

      if (!found) return Fail(FT.NotFound, 'User not found');
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findOne(uuid: string): AsyncFailable<EUserBackend> {
    try {
      const found = await this.usersRepository.findOne({
        where: { id: uuid },
      });

      if (!found) return Fail(FT.NotFound, 'User not found');
      return found as EUserBackend;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findMany(
    count: number,
    page: number,
  ): AsyncFailable<FindResult<EUserBackend>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [users, amount] = await this.usersRepository.findAndCount({
        take: count,
        skip: count * page,
        order: { username: 'ASC' },
      });

      if (users === undefined) return Fail(FT.NotFound, 'Users not found');

      return {
        results: users,
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async count(): AsyncFailable<number> {
    try {
      return await this.usersRepository.count();
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async exists(username: string): Promise<boolean> {
    return HasSuccess(await this.findByUsername(username));
  }

  // Internal

  private async getBCryptStrength(): Promise<number> {
    const result = await this.prefService.getNumberPreference(
      SysPreference.BCryptStrength,
    );
    if (HasFailed(result)) {
      return 12;
    }
    return result;
  }
}
