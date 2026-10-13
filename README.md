<img align="left" width="100" height="100" style="border-radius: 15%" src="branding/logo/picsur.svg"/>

# Picsur

> Self-hosted image sharing — an Imgur / Pastebin hybrid.

**This repository is an independently maintained fork** of
[Picsur](https://github.com/CaramelFur/Picsur) (by Caramel, AGPL-3.0).
Upstream stopped being maintained in 2024; this fork is maintained by
[@zhemed](https://github.com/zhemed) and carries its own build, deploy and
dependency-security pipeline.

> 上游已停止维护。本仓库是自维护分支：自带构建/部署流水线、独立的依赖安全基线，
> 并且**不向上游或任何第三方上报遥测数据**（`ReportUrl` 已置空，见 `backend/src/config/config.static.ts`）。

## Features

- Uploading and viewing images, anonymous uploads
- User accounts, roles and permissions
- EXIF stripping, optional "keep original"
- Formats: QOI, JPG, PNG, WEBP (animated), TIFF, HEIF, BMP, GIF (animated), JPEG-XL, JPEG-2000
- Convert & edit images: resize, rotate, flip, strip transparency, negative, greyscale
- Deletable and expiring images, ShareX endpoint, proper DB migrations
- Self-built container image with the **full codec set** (HEIF / JXL / JP2 — the
  upstream prebuilt `sharp` binaries do not have these; see `Dockerfile`)

## Quick start (Docker)

```bash
cp .env.example .env # set PICSUR_ADMIN_PASSWORD and PICSUR_JWT_SECRET
docker compose up -d --build
# -> http://localhost:8080  (login: admin / whatever you set)
```

The image is built from the [`Dockerfile`](./Dockerfile) in this repository.
It does **not** pull any upstream image and does **not** depend on upstream's
private build layers.

## Build from source

Requires **Node 20** and **pnpm 9.6.0** (see `.nvmrc` / `packageManager`):

```bash
corepack enable && corepack prepare pnpm@9.6.0 --activate
pnpm install
pnpm --filter picsur-shared build
pnpm --filter picsur-backend build
pnpm --filter picsur-frontend build
node backend/dist/main.js # after setting the env vars from .env
```

> ⚠️ Installing dependencies with **Node ≥ 22.16 fails**: `qoi-img`, `bmp-img`
> and `posix.js` compile native code that no longer builds against the newer
> N-API signatures. Running the built output on newer Node is fine.
> Full toolchain contract: [`.trellis/spec/picsur-backend/backend/build-and-deploy.md`](.trellis/spec/picsur-backend/backend/build-and-deploy.md).

## Configuration

All variables are prefixed `PICSUR_` (see [`.env.example`](./.env.example)):

| Variable                                           | Default                            | Notes                                                                     |
| -------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `PICSUR_ADMIN_PASSWORD`                            | —                                  | required; username is always `admin`                                      |
| `PICSUR_JWT_SECRET`                                | random                             | set it, otherwise every restart logs everyone out                         |
| `PICSUR_DB_{HOST,PORT,USERNAME,PASSWORD,DATABASE}` | `localhost` / `5432` / `picsur` ×3 |                                                                           |
| `PICSUR_PORT` / `PICSUR_HOST`                      | `8080` / `0.0.0.0`                 |                                                                           |
| `PICSUR_MAX_FILE_SIZE`                             | `128000000`                        | bytes                                                                     |
| `PICSUR_STATIC_FRONTEND_ROOT`                      | `/picsur/frontend/dist`            | change only with a custom frontend                                        |
| `PICSUR_PRODUCTION`                                | `false`                            | **set `true` in production** (otherwise TypeORM synchronizes the schema)  |
| `PICSUR_VERBOSE`                                   | `false`                            | ⚠️ do **not** enable: it logs the JWT secret and DB password in plaintext |
| `PICSUR_TELEMETRY`                                 | `true`                             | cosmetic only — reporting is disabled because no endpoint is configured   |

## API

TypeScript schemas live in [`shared/`](./shared); the HTTP contract (paths,
status codes, error matrix) is documented in
[`.trellis/spec/picsur-backend/backend/image-api-contracts.md`](.trellis/spec/picsur-backend/backend/image-api-contracts.md).

## Status

- Production dependency audit: **0 advisories** (`pnpm audit --prod`); the
  upgrade record is under `.trellis/tasks/archive/`.
- Not done yet: Angular major upgrade (browser-side advisories in the shipped
  bundle), pluggable storage backends (local files / S3), albums / public gallery.

## License

AGPL-3.0 — see [`LICENSE`](./LICENSE). This repository contains code
copyright Caramel and contributors, originally from
<https://github.com/CaramelFur/Picsur>, and is distributed under the same license.
