# 修正部署文档：手动升级必须先 pull

## 背景

`docker run` 不会自动拉新镜像；README 原话「docker rm -f picsur 后再跑同一条命令」会用到本地旧缓存，实测在 189y.de 上导致版本没变。

## 改动

README 的升级说明改为：先 `docker pull` 再重建，并指向面板「立即升级」。

## 验收

- [x] README 升级段落包含 docker pull
- [x] commit + push
