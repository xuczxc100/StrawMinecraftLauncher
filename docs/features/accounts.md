# 帳號

## 離線帳號

- 輸入 3–16 字元的玩家名稱（英數與底線），UUID 以 `@xmcl/user` 的 `getOfflineUUID` 產生（與官方離線 UUID 規則一致）。
- 首頁在使用離線帳號時提示「請支持正版」。

## 微軟帳號（裝置碼流程）

1. 需要 Azure App client ID：設定頁欄位優先，其次環境變數 `SMCL_MS_CLIENT_ID`。沒有設定時「新增微軟帳號」按鈕停用，並顯示 `ms-not-configured` 提示。
2. 向 `login.microsoftonline.com/consumers` 取得裝置碼，介面顯示代碼並開啟驗證網址。
3. 輪詢取得 OAuth 權杖 → Xbox Live → XSTS → Minecraft Services 登入 → 取得玩家資料（帳號沒有 Java 版時回報 `NoMinecraftProfile`）。
4. Minecraft access token 與 refresh token 以 Electron `safeStorage` 加密後寫入 `accounts.json`；作業系統不支援加密（例如 Linux 沒有 keyring）時退回不加密存放。
5. 啟動前若 token 即將過期會自動 refresh；refresh 失敗會回報 `MicrosoftRelogin`，請使用者重新登入。

Azure App 要求：個人 Microsoft 帳戶類型、啟用公用用戶端流程，並已向 Mojang 申請 Minecraft API 權限。

## 測試

`tests/unit/account.test.ts` 以 mock fetch 跑完整的裝置碼 → Xbox → XSTS → Minecraft 流程、refresh 與錯誤碼。
