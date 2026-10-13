# 修复：界面文字无法选中复制

## 根因（已实测）

`frontend/src/scss/fixes.scss`（经 `scss/index.scss` → `styles.scss` 全局引入）里有上游遗留的：

```scss
:not(input) {
  -webkit-user-select: none; -moz-user-select: none;
  -ms-user-select: none;     user-select: none;
}
```

`docker`… 实测 `body` / `span` 的 `user-select` 计算值均为 `none`，即**除 `<input>` 外整站不可选中**。
图片链接之所以能复制，是因为 `copy-field` 把值放在 `<input>` 里。

## 方案（用户选定 1）

删除该规则。Material 已对按钮/图标/菜单项自行禁用选中，不需要全局兜底。

## 验收标准

- [ ] AC1 规则删除后：`body` / `span` / 段落 / 表格单元格的 `user-select` 计算值不再是 `none`（浏览器实测）。
- [ ] AC2 实际可选：在真实页面用 DOM 选区 API 选中一段正文（labels/提示），`window.getSelection().toString()` 非空。
- [ ] AC3 `<input>` 行为不变（仍可选中、复制按钮照旧工作）。
- [ ] AC4 三包构建通过；本地发布 0.7.4；常驻实例经面板升级后同样验证 AC1/AC2。
