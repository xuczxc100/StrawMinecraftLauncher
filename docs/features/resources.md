# Mod／資源包／光影

## 來源

| 來源 | 套件 | 金鑰 |
| --- | --- | --- |
| Modrinth | `@xmcl/modrinth` | 不需要 |
| CurseForge | `@xmcl/curseforge` | 需要；設定頁或 `SMCL_CURSEFORGE_KEY` |

沒有 CurseForge 金鑰時，資源頁切到 CurseForge 會顯示 `curseforge-missing` 提示，不發出請求。

## 搜尋

- 類型：Mod、資源包、光影、整合包；排序：相關性、下載數、最近更新、最新上架。
- 勾選「只顯示相容版本」時依目標實例的 Minecraft 版本與載入器過濾。
- 每頁 20 筆，輸入停止 350ms 後自動搜尋。

## 安裝（`ResourceService.install`）

1. 取得目標實例相容的最新版本。
2. `planInstall` 以廣度優先解析必要相依（`required`）：已安裝或已排入的專案略過（因此不會無限循環），相依指定版本時照用，否則取最新相容版本；找不到相容版本的相依會列為略過。
3. 下載到 `.part` 暫存檔並校驗 SHA-1（不符回報 `ChecksumMismatch`），再改名寫入 `mods/`、`resourcepacks/` 或 `shaderpacks/`。
4. 同一專案的舊版本檔案會被移除；來源資訊記錄在 `.smcl/resources.json`。

## 本機管理

- 列出實例內的檔案；Mod 以 `@xmcl/mod-parser` 讀取名稱、版本與 modId（Fabric、Quilt、Forge `mods.toml`）。
- 已知限制：mod-parser 3.4.2 不支援 NeoForge 1.20.5+ 的 `neoforge.mods.toml`，這類 Mod 會顯示 Modrinth 標題或檔名。
- 啟用／停用＝加上或移除 `.disabled` 副檔名；刪除前確認；可開啟資料夾。

## 測試

- `tests/unit/resources.test.ts`、`resource-install.test.ts`：相依解析、校驗失敗、舊版移除、停用與刪除。
- `tests/integration/modrinth.test.ts`：實際從 Modrinth 安裝 Fabric API 並解析 modId。
