# 去掉页脚

## 背景

上传页/各页底部有一行页脚：「由 ♥ 制作 zhemed - V0.7.4 - 源代码」。用户认为它影响观感，要求去掉。

## 改动范围

- `frontend/src/app/app.component.html:26` 的 `<app-footer></app-footer>`（全仓库唯一引用）
- `frontend/src/app/app.module.ts` 里对应的 `FooterModule` 引用（避免留下死导入）
- 组件文件本身保留（不删文件），只是不再渲染

## 验收标准

- [ ] AC1 真实页面里 `document.querySelector('app-footer')` 为 `null`（浏览器实测，绕缓存）。
- [ ] AC2 底部不再有那行文字；内容区高度/滚动正常（上传框仍垂直居中、无多余空白）。
- [ ] AC3 三包构建通过；版本 0.7.5；本地发布成功。
- [ ] AC4 常驻实例经面板升级到 0.7.5 后同样满足 AC1/AC2，数据无损。
