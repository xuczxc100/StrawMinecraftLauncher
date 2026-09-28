# 版本安裝

使用 `@xmcl/installer` 6.x 的 resolve／workflow API，由 `util/install.ts` 的 `runManifest`／`runWorkflow` 執行並回報進度到任務系統。

| 載入器 | 版本清單 | 安裝 |
| --- | --- | --- |
| 原版 | `getVersionList` | `resolveMinecraftVersionJsonInstallFile`、`resolveMinecraftJarInstallFile`、`resolveLibraryInstallFiles`、`resolveAssetMetadataInstallManifest`、`resolveAssetObjectInstallFiles` |
| Fabric | `getLoaderArtifactListFor` | `createFabricInstallWorkflow` |
| Quilt | `getQuiltLoaderVersionsByMinecraft` | `createQuiltInstallWorkflow` |
| Forge | `getForgeVersionList` | `resolveForgeInstallerFile` + `createModernForgeInstallWorkflow`（1.4.x 用 `createLegacyForgeInstallWorkflow`） |
| NeoForge | NeoForged Maven API（1.20.1 讀 `forge` 構件，其後讀 `neoforge`） | `resolveNeoForgedInstallerFile` + `createModernForgeInstallWorkflow` |

- 一律先裝好原版（版本 JSON、client jar、libraries、asset 索引與物件），再安裝載入器，最後補齊載入器版本新增的 libraries。
- Forge／NeoForge 安裝前先透過 JavaService 取得原版要求的 Java，用來執行 installer processors。
- `useHashForAssetsIndex: true`：與 `diagnoseInstallation` 的檢查方式一致（索引存在 `assets/indexes/<sha1>.json`），避免每次啟動都判定索引缺失而重新下載。
- 啟動前的修復只補 jar、libraries、assets；載入器檔案損壞時回報 `LoaderCorrupted`，請使用者重新安裝版本。

## 鏡像

設定頁可選「官方」或「BMCLAPI」。BMCLAPI 模式會改寫版本清單、版本 JSON、client、asset 索引與物件、Maven 與 Fabric meta 的網址。

- `json` / `client` / `assetsIndexUrl` / Maven 選項：installer 會自動把原網址附加為備援。
- `assetsHost`：installer 不會自動備援，所以 SMCL 明確設為 `[BMCLAPI/assets, 官方資源站]`。

## 測試

`tests/integration/install.test.ts`（`npm run test:integration`，需網路）：實際安裝原版與 Fabric 1.20.1 並確認 `diagnoseInstallation` 無問題；讀取 Forge／NeoForge／Quilt 版本清單；設 `SMCL_INTEGRATION_FORGE=1` 時實際安裝 Forge。
