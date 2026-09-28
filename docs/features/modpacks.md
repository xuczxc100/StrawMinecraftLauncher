# 整合包

## 匯入

- **`.mrpack`**：讀取 `modrinth.index.json`，依 `dependencies` 建立實例（minecraft + fabric-loader／quilt-loader／forge／neoforge），下載 `files[]`（校驗 hash、只接受 client 需要的檔案），解壓 `overrides/` 與 `client-overrides/`。
- **CurseForge 整合包**：讀取 `manifest.json`，依 `modLoaders` 建立實例，透過 CurseForge API 查詢並下載 `files[]`（沒有金鑰時回報 `CurseforgeNotConfigured`），依專案分類放進 mods／resourcepacks／shaderpacks，解壓 `overrides`。作者禁止第三方下載（沒有 `downloadUrl`）的檔案會略過，清單寫在實例目錄的 `SMCL-skipped-files.txt`。
- **線上匯入**：資源頁的整合包分類直接下載並匯入。
- 匯入完成後自動安裝版本；失敗時刪除半成品實例。

## 安全檢查

- 壓縮檔條目名稱含 `..` 或絕對路徑時拒絕（`InvalidModpack`）。
- `files[].path` 解析後必須位於實例目錄內，否則拒絕。
- 不是合法 zip 或缺少索引檔時回報 `InvalidModpack`。

## 匯出 `.mrpack`

- 可勾選要包含的項目：mods、resourcepacks、shaderpacks、config、options.txt、servers.dat（預設前四項）。
- mods／資源包／光影資料夾內的檔案先計算 SHA-1／SHA-512，再以 SHA-1 向 Modrinth 查詢；查得到的寫成 `files[]`（含 hash 與下載網址），其餘檔案放進 `overrides/`。查詢失敗時全部放進 overrides。

## 測試

`tests/unit/modpack.test.ts`：匯出後再匯入的往返測試、zip slip、索引路徑穿越、CurseForge 匯入。E2E 從介面匯出再匯入。
