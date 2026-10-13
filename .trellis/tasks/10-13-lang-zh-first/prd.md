# 语言菜单中文置顶 + 复核默认语言为简体中文

## 现状（已勘察）

- `frontend/src/app/i18n/i18n.service.ts`：`availableLanguages = ['en', 'zh']` —— **数组顺序就是菜单显示顺序**，所以 English 在前。
- `defaultLanguage = 'zh'`、`fallbackLanguage = defaultLanguage`；`getInitialLanguage()` 只读 `localStorage`，
  读不到就用 `fallbackLanguage`，`toAvailableLanguage()` 只是把已存的 `zh-CN` 解析成 `zh` —— **全链路没有浏览器语言嗅探**。
- `header.component.ts` 里有个 `currentLanguage = 'en'` 的占位初值（服务推送前的一帧）。

## 需求

1. 数组顺序改为 `['zh', 'en']` → 菜单里**中文第一**。
2. 默认语言**保持/确认为简体中文**：无 localStorage 记录时必须 `zh`；已有记录（en/zh）尊重记录。
3. 页头占位初值改用 `defaultLanguage`，避免首帧高亮错语言。
4. 发 **0.7.3**（本地发布流程），并把常驻实例升级过去。

## 验收标准

- [ ] AC1 语言菜单顺序：中文在前（截图 + DOM 顺序量测）。
- [ ] AC2 清空 `localStorage` 后首访 `html.lang=zh`、界面为中文、菜单勾选「中文」。
- [ ] AC3 代码层复核：无 `navigator.language` 等外部语言来源（grep 留证）。
- [ ] AC4 三包构建通过；本地发布 `0.7.3` 成功（`:0.7.3/:0.7/:latest/:allinone`）。
- [ ] AC5 常驻实例用面板一键升级到 0.7.3，数据完好，菜单顺序与默认语言在真实实例上复核通过。
