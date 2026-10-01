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

## 送出的可靠性

- 前端每次送出會帶一組 `sid`，後端以 `CacheService` 記住 6 小時並據此去重。
  使用者連點兩下、或第一次請求讀不到回應而自動重送，都只會寫入一筆名單。
- 寫入試算表包在 `LockService` 裡，多人同時送出不會互相覆蓋；寄信刻意放在鎖外，
  避免寄信變慢時拖住其他人的送出。
- 若 `fetch` 讀不到回應（通常是跨網域限制），前端會以 `mode: 'no-cors'` 重送一次，
  靠 `sid` 保證不重複。

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
