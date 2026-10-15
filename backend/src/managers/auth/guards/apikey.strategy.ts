import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HeaderAPIKeyStrategy } from 'passport-headerapikey';
import { EUser, EUserSchema } from 'picsur-shared/dist/entities/user.entity';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { IsApiKey } from 'picsur-shared/dist/validators/api-key.validator';
import { ApiKeyDbService } from '../../../collections/apikey-db/apikey-db.service.js';
import { EUserBackend2EUser } from '../../../models/transformers/user.transformer.js';
import { RedactSecret, SanitizeLogValue } from '../../../util/redact.js';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(
  HeaderAPIKeyStrategy,
  'apikey',
) {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly apikeyDB: ApiKeyDbService) {
    // @nestjs/passport >= 11 wraps the strategy and appends its own verify
    // callback itself (it calls `super(...args, callback)` and drives
    // `this.validate(...)`). Passing a third argument here is therefore both
    // rejected by the mixin's types and wrong at runtime.
    super(
      {
        header: 'Authorization',
        prefix: 'Api-Key ',
      },
      false,
    );
  }

  async validate(apikey: string): Promise<EUser | false> {
    const apiValidation = await IsApiKey().safeParseAsync(apikey);
    if (!apiValidation.success) {
      // Never log the value itself: it is a credential, and this line also
      // runs for keys that are merely unknown to this instance (audit A-5).
      this.logger.warn('Invalid apikey format: ' + RedactSecret(apikey));
      return false;
    }

    const apikeyResult = await this.apikeyDB.resolve(apikey);
    if (HasFailed(apikeyResult)) {
      this.logger.warn('Invalid apikey: ' + RedactSecret(apikey));
      return false;
    }

    const user = EUserBackend2EUser(apikeyResult.user);

    const userValidation = await EUserSchema.safeParseAsync(user);
    if (!userValidation.success) {
      this.logger.error(
        'Invalid user: ' + SanitizeLogValue(JSON.stringify(user), 200),
      );
      return false;
    }

    return userValidation.data;
  }
}
