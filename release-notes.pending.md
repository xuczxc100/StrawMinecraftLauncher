# 0.1.0.0（首次發佈）

SMCL 從零打造的第一個版本，核心功能使用 XMCL 的 `@xmcl/*` 函式庫（MIT）。

## 新功能

- 微軟帳號裝置碼登入（需自行設定 Azure client ID）與離線帳號；權杖以作業系統金鑰加密。
- 安裝原版、Forge、NeoForge、Fabric、Quilt；可切換官方／BMCLAPI 下載來源。
- 自動掃描本機 Java，缺少時自動下載 Mojang Java Runtime；Java 頁可手動安裝 8／17／21／25。
- 多實例：每個實例獨立的遊戲目錄、Java、記憶體、JVM／遊戲參數、解析度與自動連線伺服器。
- Modrinth 與 CurseForge（需 API key）搜尋並安裝 Mod、資源包、光影，自動安裝必要相依；本機資源可啟用、停用、刪除。
- 匯入 `.mrpack` 與 CurseForge 整合包（檔案或線上），匯出 `.mrpack`。
- 啟動前檢查並補齊缺檔；即時遊戲日誌（log4j 事件轉成易讀格式、錯誤標紅）；當機報告偵測。
- 任務抽屜顯示所有下載與安裝進度，可取消。
- 深色／淺色主題、自訂強調色、繁體中文／English。

## 開發工具（0.1.0.1）

- GitHub Actions 升級到支援 Node 24 的版本（checkout／setup-node v7、upload-artifact v7、download-artifact v8、action-gh-release v3）。
- `scripts/sync-version.mjs` 同步版本到 `package-lock.json`，避免 lockfile 根版本與 `package.json` 不一致。

## 平台

Windows（NSIS）、Linux（AppImage、deb）、macOS（dmg，x64 與 arm64，未簽章）。

## 已知限制

- 微軟登入與 CurseForge 需要自行申請的 Azure client ID 與 CurseForge API key。
- NeoForge 1.20.5 以後的 Mod 無法從 `neoforge.mods.toml` 讀取名稱（上游 `@xmcl/mod-parser` 尚未支援），會顯示 Modrinth 標題或檔名。
- macOS 版本未經 Apple 簽章與公證，首次開啟需在「系統設定 → 隱私權與安全性」允許。
