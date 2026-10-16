# Picsur

自维护的图床（AGPL-3.0）。NestJS + Angular + PostgreSQL，支持 PNG / JPEG / WebP / QOI /
JPEG XL / JPEG 2000 / HEIF / SVG 等格式与在线转换，内置简体中文界面。

## 部署（唯一方式）

```bash
docker run -d --name picsur --restart always \
  -p 8080:8080 \
  -v ./data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/zhemed/picsur:allinone
```

打开 `http://<主机>:8080`。登录名固定 `admin`，首次启动的管理员口令打印在
`docker logs picsur`，同时也写进 `./data/allinone.env`（600 权限）。

**所有数据（数据库 + 图片文件）都在 `./data`** —— 备份 = 备份这个目录。

## 升级（就一种方式）

面板 → 设置 →「关于」→ 点「立即升级」。

升级能力来自上面那行 `docker.sock` 挂载；不想要它，删掉那行即可 ——
面板会改为显示可复制的手动升级命令，其它功能不受影响。

## 开发

构建环境、发布流程、备份/恢复、排障见 [docs/MAINTAINING.md](docs/MAINTAINING.md)。

## 许可

AGPL-3.0-or-later。源自 [Picsur](https://github.com/rubikscraft/Picsur)（上游已停更），本仓库自行维护。
