# 架構

## 程序分工

- **Main**（`src/main`）：所有檔案、網路與子程序操作。每個領域一個 Service（`services/*.ts`），在 `index.ts` 組裝後透過 `util/ipc.ts` 註冊為 IPC handler。
- **Preload**（`src/preload`）：以 `contextBridge` 暴露 `window.smcl.invoke / on`，只允許 `SMCL_INVOKE_CHANNELS` 與 `SMCL_EVENT_CHANNELS` 內的頻道。
- **Renderer**（`src/renderer`）：Vue 3 + Pinia + vue-router + vue-i18n，不直接接觸 Node。
- **Shared**（`src/shared`）：IPC 頻道與型別定義（`ipc.ts`、`types.ts`），main 與 renderer 共用。

## IPC 約定

- 頻道對應表 `SmclInvokeMap` 同時約束參數與回傳型別；單元測試 `util-ipc.test.ts` 會檢查每個頻道都有 handler。
- Main 端錯誤統一包成 `SmclError(code, message)`，renderer 以 `errorCode()` 取代碼、`errors.<code>` 翻譯顯示。
- Renderer 的 `invoke()` 會先以 `toPlain()` 把 Vue reactive Proxy 深層轉成純物件（structured clone 無法複製 Proxy），並保留 `undefined`（`instance:update` 用它清除欄位）。

## 任務系統

`TaskService` 管理所有長時間工作（安裝、下載、啟動準備、整合包）：

- 每個任務有 `id / title / status / progress / total / children`，狀態變化透過 `task:update` 事件推送到 renderer 的任務抽屜。
- 支援 `AbortSignal` 取消；子任務（例如整合包內的逐檔下載）掛在父任務下。
- 沒有使用 `@xmcl/task`：SMCL 需要跨 IPC 序列化與取消，自寫的 TaskService 較簡單。

## 資料目錄

預設為 Electron 的 `userData`，可用 `SMCL_DATA_DIR` 覆寫（測試用）。

```
<data>/
  config.json        設定
  accounts.json      帳號（權杖以 safeStorage 加密）
  java.json          已知 Java 清單
  minecraft/         共用 versions/ libraries/ assets/
  instances/<id>/    各實例遊戲目錄（mods/ resourcepacks/ shaderpacks/ saves/ config/）
    instance.json    實例設定
    .smcl/           SMCL 自己的中繼資料（已安裝資源來源等）
  java/              Mojang Java Runtime
  cache/ temp/
```

## 單一執行個體

正式執行時使用 `requestSingleInstanceLock()`；E2E 以 `SMCL_ALLOW_MULTI=1` 關閉。

## 打包修正

`scripts/fix-xmcl-packaging.mjs`（postinstall）修補兩個上游發佈問題：`@xmcl/unzip@2.2.0` 的 `main` 指向未發佈的 `index.ts`（改指 `dist/`）；`@xmcl/installer@6.3.x` 需要 `@xmcl/core/utils`，但 `@xmcl/core@2.16.x` 沒有提供（補一個 shim）。`@xmcl/yauzl` 固定為 `2.10.0`（直接依賴與 overrides 一致）。
