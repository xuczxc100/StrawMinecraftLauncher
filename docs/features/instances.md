# 多實例與版本隔離

- 每個實例是 `instances/<id>/` 下獨立的遊戲目錄（`gameDir`），擁有自己的 mods、資源包、光影、存檔與 config。
- 版本檔（`versions/`、`libraries/`、`assets/`）集中在共用的 `minecraft/`，多個實例共用同一版本時不重複下載。
- `id` 由名稱產生並保證唯一；名稱以 `sanitizeFileName` 移除非法字元。

## 實例設定（`instance.json`）

| 欄位 | 說明 |
| --- | --- |
| `minecraft` / `loader` / `loaderVersion` | 遊戲版本與載入器（vanilla/forge/neoforge/fabric/quilt） |
| `versionId` | 安裝完成後實際的版本 ID（例如 `fabric-loader-0.16.x-1.20.1`） |
| `javaPath` | 指定 Java；空白＝自動選擇或下載 |
| `minMemory` / `maxMemory` | MB；空白＝使用全域預設記憶體 |
| `jvmArgs` / `mcArgs` | 額外參數，支援引號 |
| `resolution` | 視窗寬高或全螢幕 |
| `server` | 啟動後直接連線的伺服器 |
| `modpack` | 由整合包匯入時記錄來源 |

改動 Minecraft 版本、載入器或載入器版本時會清除 `versionId`，下次啟動前重新安裝。

## 介面

- 首頁：選擇實例、啟動／結束、即時日誌。
- 實例頁：清單、新增；詳細頁分為設定、Mods、資源包、光影、匯出五個分頁。
