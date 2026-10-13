import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// 本仓库（zhemed/picsur）不再向任何第三方上报遥测。
// 置空即代表「没有上报端点」，UsageService 会直接跳过（见 managers/usage/usage.service.ts）。
// 将来若要接自己的统计后端，把这里改成自己的 URL 即可。
export const ReportUrl = '';
export const ReportInterval = 1000 * 60 * 60;
export const EnvPrefix = 'PICSUR_';
export const DefaultName = 'picsur';

export const PackageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../',
);
