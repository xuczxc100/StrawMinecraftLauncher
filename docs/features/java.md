# Java

## 掃描

以 `@xmcl/installer` 的 `getPotentialJavaLocations` 找出系統候選路徑，加上 `JAVA_HOME`、SMCL 管理的 runtime 與使用者自訂路徑，交給 `scanLocalJava` 逐一驗證版本；結果依來源標記為 managed／custom／system，存在 `java.json`。

## 自動選擇

`pickJava(installs, required)`：優先選主版本完全相符者（同版本中優先 SMCL 管理或自訂的 Java）；需要 Java 16 以下的舊版遊戲只接受完全相符，較新的遊戲則可退而選最接近的較新主版本。實例可用 `javaPath` 指定。

## 自動下載

- 找不到合適 Java 時，從 Mojang 的 Java Runtime 清單（`java-runtime-alpha/beta/gamma/delta/epsilon`、`jre-legacy`）挑選對應平台與主版本的元件，下載到 `<data>/java/<component>/`。
- runtime 名稱的格式是 `17.0.15` 或 `8u202`，以 `runtimeMajorVersion()` 解析主版本。
- Java 頁可手動安裝 8／17／21／25。

## 測試

- `tests/unit/java-install.test.ts`：以本機檔案伺服器模擬 Mojang 清單與檔案，驗證下載、校驗與權限。
- `tests/integration/install.test.ts`：實際下載 Mojang Java 17。
