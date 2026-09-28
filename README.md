# StrawMinecraftLauncher (SMCL)

跨平台（Windows / Linux / macOS）的 Minecraft Java 版啟動器，以 Electron + Vue 3 + TypeScript 打造，核心功能建立在 [XMCL](https://github.com/Voxelum/x-minecraft-launcher) 的 `@xmcl/*` 函式庫之上。

## 功能

- 微軟帳號（裝置碼登入）與離線帳號
- 安裝原版、Forge、NeoForge、Fabric、Quilt，可切換 BMCLAPI 鏡像
- 自動偵測本機 Java，並依版本需求自動下載 Mojang Java Runtime
- 多實例（版本隔離）：每個實例有獨立的遊戲目錄、Java、記憶體、JVM 參數
- 從 Modrinth / CurseForge 搜尋並安裝 Mod、資源包、光影（自動處理必要相依）
- 匯入 `.mrpack` 與 CurseForge 整合包，匯出 `.mrpack`
- 啟動前檢查並補齊缺檔、即時遊戲日誌、當機報告偵測

各功能的詳細說明見 [docs/features](docs/features/README.md)。

## 下載

到 [Releases](https://github.com/xuczxc100/StrawMinecraftLauncher/releases) 下載對應平台的安裝檔（Windows `.exe`、Linux `.AppImage`／`.deb`、macOS `.dmg`）。

## 開發

```bash
npm ci
npm run dev          # 開發模式
npm run lint
npm run typecheck
npm test             # 單元測試
npm run test:integration   # 需網路：實際安裝版本、下載 Mod
npm run test:e2e     # Playwright Electron E2E
npm run dist:linux   # 打包（dist:win / dist:mac）
```

### 金鑰設定

| 功能 | 環境變數 | 設定頁欄位 |
| --- | --- | --- |
| 微軟登入 | `SMCL_MS_CLIENT_ID` | Azure App client ID |
| CurseForge | `SMCL_CURSEFORGE_KEY` | CurseForge API key |

沒有設定時，對應功能會停用並在介面上提示；離線帳號與 Modrinth 不需要金鑰。
Azure App 需要是「個人 Microsoft 帳戶」類型、啟用「公用用戶端流程」，並向 Mojang 申請 Minecraft API 權限。

### 版本號

版本格式為 `a.b.c.d`（`d` 為預覽號，`0` 代表正式版），存在 `VERSION`。任何原始碼或設定改動都要執行 `scripts/bump-version.sh`，CI 的 `check-version-bump` 會檢查。

## 授權與聲明

- 本專案以 MIT 授權釋出，詳見 [LICENSE](LICENSE)。
- 核心功能使用 XMCL 的 `@xmcl/*` 套件（MIT，Copyright (c) 2023 ci010）。
- SMCL 是獨立開發的專案，與 Plain Craft Launcher（PCL）、龍騰貓躍及 Mojang / Microsoft 無任何關聯。
- Minecraft 是 Mojang AB 的商標。請支持正版遊戲。
