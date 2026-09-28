# 測試與發佈

## 測試分層

| 指令 | 內容 | 需求 |
| --- | --- | --- |
| `npm run lint` | ESLint（typescript-eslint + eslint-plugin-vue） | |
| `npm run typecheck` | main／web／test 三份 tsconfig | |
| `npm test` | Vitest 單元測試（`tests/unit`） | |
| `npm run test:integration` | 實際安裝版本、下載 Java、Modrinth、啟動遊戲 | 網路；啟動測試需 DISPLAY |
| `npm run test:e2e` | 建置後以 Playwright `_electron` 跑完整介面流程並截圖 | DISPLAY |

Linux 無桌面環境時：

```bash
xvfb-run -a -s "-screen 0 1400x900x24 +extension GLX" npm run test:e2e
```

以 root 執行時 E2E 會自動加 `--no-sandbox`。整合測試快取在 `.smcl-test/integration`，E2E 的啟動測試會以 symlink 重用。

### 打包後驗證

```bash
npm run dist:linux
SMCL_PACKAGED=$PWD/release/<version>/SMCL-<version>-linux-x86_64.AppImage \
  xvfb-run -a npx playwright test tests/e2e/packaged.spec.ts
```

`packaged.spec.ts` 確認 `app.isPackaged`、關於頁版本、Modrinth 搜尋、Java 掃描與版本清單在 asar 內正常運作。沒有 FUSE 的環境以 `APPIMAGE_EXTRACT_AND_RUN=1` 執行（spec 已內建）。

## CI（`.github/workflows/ci.yml`）

push／PR 到 `main`：`npm ci` → check-version-bump → lint → typecheck → 單元測試 → build。

## 版本

- `VERSION` 格式 `a.b.c.d`，`d` 為預覽號，`0` 為正式版；`scripts/sync-version.mjs` 轉成 semver（`a.b.c` 或 `a.b.c-preview.d`）寫入 `package.json`。
- 任何原始碼或設定改動都要 `bash scripts/bump-version.sh`；只改 `docs/`、`README.md`、`release-notes.pending.md` 不需要。

## 發佈（`.github/workflows/release.yml`）

推送 `v*` tag 觸發 Ubuntu／Windows／macOS 矩陣打包：

| 平台 | 產物 |
| --- | --- |
| Linux | AppImage、deb |
| Windows | NSIS 安裝檔（x64） |
| macOS | dmg（x64、arm64，未簽章） |

產物上傳到 GitHub Release；tag 不以 `.0` 結尾時標為 prerelease。
