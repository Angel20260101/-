# 心情AED Landing Page

企業員工心理健康即時預警平台的行銷落地頁，前台表單直接串 Google 試算表後台。

## 架構

```
index.html (GitHub Pages)
      │  fetch POST (application/x-www-form-urlencoded)
      ▼
Google Apps Script 網頁應用程式 (apps-script/Code.gs)
      ├──► 寫入 Google 試算表（後台名單）
      ├──► 寄自動回覆信給填單者
      └──► 寄新名單通知信給表單擁有者
```

## 檔案

| 路徑 | 說明 |
|---|---|
| `index.html` | 落地頁本體 |
| `assets/` | 圖片與防護網影片（原本內嵌為 base64，已抽出並壓縮） |
| `apps-script/Code.gs` | 後端程式碼，貼到 Google 試算表的 Apps Script 編輯器 |
| `order-query.html` | 先前的訂單查詢頁，暫存保留 |

## 上線設定

1. 建立 Google 試算表，第一列欄位依序為：
   `送出時間 / 姓名 / 職稱 / 公司名稱 / 員工人數規模 / 聯絡電話 / 聯絡信箱 / 需求說明 / 處理狀態`
2. 「擴充功能 → Apps Script」貼上 `apps-script/Code.gs`，修改 `OWNER_EMAIL`
3. 「部署 → 新增部署作業 → 網頁應用程式」，執行身分「我」、存取權「任何人」，取得 `/exec` 網址
4. 把該網址填入 `index.html` 的 `FORM_ENDPOINT`（已設定）
5. 在 GitHub 開啟 Pages（Settings → Pages → Branch）

## 試算表的取得方式

`Code.gs` 用 `SHEET_ID` 以 `openById` 開啟試算表，而不是只靠 `getActiveSpreadsheet()`。
獨立建立（非從試算表「擴充功能」進入）的 Apps Script 專案，`getActiveSpreadsheet()` 會回傳
`null`，寫入就會在 `doPost` 裡丟例外而從外面看不出來。換試算表時改 `SHEET_ID` 這一行。

`testSetup()` 的輸出會一併回報目前是哪一種（綁定式／獨立式）。

## 確認線上跑的是哪一版

`Code.gs` 裡有 `CODE_VERSION`，`doGet` 會把它回傳。用瀏覽器打開部署的 `/exec` 網址即可看到：

```json
{"ok":true,"service":"心情AED form endpoint","version":"2026-10-01","features":["dedupe","lock","mail"]}
```

改完程式碼要讓線上生效，是「部署 → **管理部署作業** → ✏️ → 版本選**新版本** → 部署」。
按「新增部署作業」會產生另一個網址，`index.html` 的 `FORM_ENDPOINT` 就會指到舊的那個。

## 表單如何運作

落地頁**不自己送出表單**。`#contact-form` 是一個 CTA 面板，按鈕連到 Google 表單：

```
訪客 ──► Google 表單頁（Google 自己的網域，沒有跨網域問題）
            │ 送出
            ▼
      回覆寫入「心情AED-名單後台」
            │
            ▼
   onFormSubmit 觸發器（Google 伺服器端）──► 寄兩封信
```

這個形狀是踩過坑之後的結果。先前落地頁用自己的表單直接打 Apps Script 網頁應用程式，
在 iOS Safari 上**四種送出方式全部失敗**（fetch POST、iframe 表單 POST、JSONP、整頁導向），
而同一支手機直接開 `/exec` 卻正常。從自己的網域送到 `script.google.com` 這件事，
受瀏覽器政策管轄，而該政策因瀏覽器、版本、使用者設定而異，落地頁賭不起。

**不要把送出邏輯搬回頁面裡。** 相關程式碼保留在 git 歷史（`apps-script/Code.gs`
與 index.html 的 JSONP/iframe 版本），要考古再去翻。

| 要改什麼 | 改哪裡 |
|---|---|
| 表單題目 | Google 表單本身。題目文字可微調，`FN_FIELD_MATCHERS` 用關鍵字比對 |
| 信件內容 | `apps-script/FormNotify.gs` 的 `fnLeadMailHtml` / `fnOwnerMailHtml` |
| 通知收件人 | `FN_OWNER_EMAIL` |
| 落地頁按鈕連結 | `index.html` 裡 `.form-cta` 的 `href` |

`FormNotify.gs` 的全域名稱都有 `FN_` / `fn` 前綴。Apps Script 所有 `.gs` 共用同一個
全域範圍，同名 `const` 會讓整個專案跑不起來。

## 效能注意事項

進站影片彈窗是整頁最重的資源，維護時請守住三件事：

1. **所有 mp4 必須開啟 faststart**（`moov` atom 置於 `mdat` 之前），否則瀏覽器要下載完整支影片才能播出第一格。
   檢查：`ffprobe -v trace -i file.mp4 2>&1 | grep -n 'type:.moov\|type:.mdat'`
   修正：`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`
2. **不要把照片存成 PNG**。滿版圖一律 WebP + JPEG fallback，用 `<picture>` 包起來。
3. **影片彈窗的 watchdog 不要拿掉**。`START_WAIT` 逾時未開始播放就會關閉彈窗並中止下載，
   這是避免多人同時進站時整群卡在黑畫面的保險絲。

4. **每個畫質分支都要同時提供 WebM 與 MP4**。只給單一格式時，碰上不支援該編碼的
   瀏覽器就沒有退路（開源版 Chromium 不含 H.264 即為一例）。
5. **頁面中段的防護網影片維持 `preload="none"` + IntersectionObserver**，捲到附近才載入。

自動播放採用 `muted` + `playsinline`，這是各家瀏覽器都允許的組合。被擋下時
（iOS 低耗電模式、使用者自行關閉自動播放）彈窗會留著並改顯示提示，由使用者自行點擊播放。

單次進站傳輸量（桌機實測）：首屏 0.25 MB，看完進站影片約 7.3 MB，捲到底約 8.9 MB。

## 注意事項

- 一般 Gmail 帳號透過 Apps Script 每日寄信上限 100 封，Workspace 為 1500 封
- 優惠倒數截止時間寫死在 `index.html` 的 `deadline` 變數
- 表單含 honeypot 欄位 `bot-field`，後端偵測到有值即略過寫入
