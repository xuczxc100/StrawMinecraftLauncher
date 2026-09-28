# 啟動

## 流程（`LaunchService`）

1. 若實例尚未安裝（沒有 `versionId`）先安裝。
2. `diagnoseInstallation` 檢查版本 JSON、client jar、libraries、assets；有問題時只補缺漏檔案。
3. 取得 Java（自動選擇或下載）與帳號憑證（微軟帳號必要時 refresh）。
4. 以 `@xmcl/core` 的 `launch` 啟動，`gamePath` 為實例目錄、`resourcePath` 為共用 `minecraft/`，帶入記憶體、JVM／遊戲參數、解析度與伺服器。
5. 設定「啟動後關閉啟動器」時，遊戲啟動後隱藏視窗；所有遊戲結束後重新顯示。

同一實例同時只能執行一次（`AlreadyRunning`）。

## 日誌

- 原版以 log4j XML 事件輸出日誌；`util/log4j.ts` 的 `Log4jLineParser` 會轉成 `[HH:MM:SS] [thread/LEVEL]: 訊息`，ERROR／FATAL 行標記為錯誤。
- 非 XML 的行（例如模組載入器）原樣輸出。
- 首頁日誌檢視自動捲動，錯誤行以紅色顯示。

## 結束與當機

- 使用者按「結束遊戲」→ 狀態 `exited`（即使 exit code 非 0）。
- `@xmcl/core` 的程序監看回報當機報告，或非使用者中止且 exit code 非 0 → 狀態 `crashed`，首頁顯示當機報告內容與路徑。

## 測試

- `tests/integration/launch.test.ts`：有 DISPLAY 時實際以離線帳號啟動原版，等到 `Setting user` 或 LWJGL 初始化後結束，確認狀態為 `exited`。
- `tests/e2e/flow.spec.ts`：從介面啟動原版直到遊戲初始化，再按結束。
