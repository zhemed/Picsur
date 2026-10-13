# 还原页脚并发布 0.7.6

## 需求

1. `git revert` 掉 8ee0d99（去掉页脚）的改动：`app.component.html` 恢复 `<app-footer>`、`app.module.ts` 恢复 `FooterModule` 导入。
2. 版本号前进到 **0.7.6**（不回退版本号）。
3. 本地发布（`:0.7.6 / :v0.7.6 / :0.7 / :latest / :allinone`）。
4. 用面板把常驻实例升到 0.7.6。

## 验收标准

- [ ] AC1 `git diff 0.7.4的树 新HEAD的树` 在 footer 相关文件上无差异（还原彻底）。
- [ ] AC2 三包构建通过。
- [ ] AC3 真实实例上 `document.querySelector('app-footer')` 非 null，页面底部那行文字回来，版本显示 0.7.6。
- [ ] AC4 数据无损（图片 sha/行数一致）。
