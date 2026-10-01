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

## 回報送出問題

在網址後面加上 `?debug=1`（例如 `https://angel20260101.github.io/-/?debug=1`）再送出表單，
表單下方的訊息會附上技術細節：HTTP 狀態、回應內容，以及兩次嘗試各自的錯誤。
截圖那段訊息即可定位問題，不需要開開發者工具。

## 送出的可靠性

- 前端每次送出會帶一組 `sid`，後端以 `CacheService` 記住 6 小時並據此去重。
  使用者連點兩下、或第一次請求讀不到回應而自動重送，都只會寫入一筆名單。
- 寫入試算表包在 `LockService` 裡，多人同時送出不會互相覆蓋；寄信刻意放在鎖外，
  避免寄信變慢時拖住其他人的送出。
送出依序嘗試三種方式，全部帶同一組 `sid`，後端去重，不會寫入第二筆：

1. **`fetch` POST** — 可用時最直接，拿得到完整回應。
2. **JSONP**（`<script src="...?action=submit&callback=...">`）— 主力備援。
   script 是子資源而非第三方框架，iOS Safari 的追蹤防護不會擋，也不受 CORS 規範，
   而且前端仍讀得到伺服器真正的回應。
3. **整頁導向**（`?action=submit&redirect=<落地頁網址>`）— 前兩者都失敗時，畫面會出現
   一個「點此完成送出」連結。伺服器處理完用 meta refresh 把瀏覽器送回落地頁並附上
   `?sent=1`，頁面據此顯示成功訊息。這就是一般的網頁瀏覽，沒有跨網域限制擋得住。

`doPost` 與 `doGet(?action=submit)` 共用 `processSubmission()`，行為完全一致。
GET 路徑會把 `note` 截到 1200 字以控制網址長度。

**不要改回用 iframe 送出。** 實測 iOS Safari 會擋掉跨網站 iframe 的請求，
而且 `load` 事件照樣觸發，會造成「顯示成功但什麼都沒發生」。

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
