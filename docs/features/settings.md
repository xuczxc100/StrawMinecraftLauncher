# 設定

| 項目 | 預設 | 說明 |
| --- | --- | --- |
| 語言 | 繁體中文 | zh-TW／English，`vue-i18n` |
| 主題 | 深色 | 深色／淺色 |
| 強調色 | `#e0a526` | 6 個預設色或自訂；按鈕文字顏色依亮度（WCAG 相對亮度 > 0.35 用深色字）自動切換 |
| 下載來源 | 官方 | 官方／BMCLAPI |
| 同時下載數 | 16 | 1–64 |
| 預設最大記憶體 | 4096 MB | 實例未指定時使用 |
| 啟動後關閉啟動器 | 關 | 遊戲執行時隱藏視窗，全部結束後再顯示 |
| Azure client ID | 空白 | 微軟登入；空白時讀 `SMCL_MS_CLIENT_ID` |
| CurseForge API key | 空白 | 空白時讀 `SMCL_CURSEFORGE_KEY` |

設定值由 `normalizeConfig` 限制範圍與格式後寫入 `config.json`，並以 `config:changed` 事件同步到介面。

## 關於

- 版本號（`package.json` 版本，由 `VERSION` 同步）與平台。
- 署名：核心功能使用 XMCL `@xmcl/*`（MIT）。
- 聲明：與 PCL、龍騰貓躍、Mojang、Microsoft 無關聯；Minecraft 是 Mojang AB 的商標。
- 連結：GitHub、XMCL、minecraft.net。
