# 心情AED Landing Page

企業員工心理健康即時預警平台的行銷落地頁。訪客在頁面上直接填表，資料進 Google
試算表，系統自動寄出兩封信 —— 全程看不到 Google 介面。

**線上網址：** https://angel20260101.github.io/-/

## 架構

```
訪客在 index.html 的表單填寫
      │ 原生 form POST（target 指向隱藏 iframe，頁面不跳走）
      ▼
Google 表單 /formResponse
      │
      ▼
「心情AED-名單後台」試算表 →「表單回覆 1」分頁
      │ onFormSubmit 觸發器（在 Google 伺服器端執行）
      ├──► 填單者收到確認信
      └──► 表單擁有者收到新名單通知信
```

寄信由伺服器端觸發器負責，不經過訪客的瀏覽器 —— 訪客送出後立刻關掉分頁也會寄。

## 檔案

| 路徑 | 說明 |
|---|---|
| `index.html` | 落地頁本體，含表單 |
| `assets/` | 圖片與影片（原本內嵌為 base64，已抽出並壓縮） |
| `apps-script/FormNotify.gs` | 貼到試算表的 Apps Script：建立／維護表單、表單送出時寄信 |
| `docs/email-template-lead.html` | 確認信的原始版型，供日後改版參考 |
| `docs/收單系統踩坑筆記.md` | 這次踩過的坑與下次的設計指南，動手前先看 |
| `order-query.html` | 先前的訂單查詢頁，與本專案無關，暫存保留 |

## Apps Script 的函式

貼在「心情AED-名單後台」試算表的 Apps Script 專案裡。**不需要部署，也沒有網址** ——
`onFormSubmit` 由 Google 的觸發器呼叫。

| 函式 | 什麼時候跑 |
|---|---|
| `setupForm()` | 從零建立一張新表單（已建好，不要再跑，會多出一張） |
| `attachExistingForm()` | 把既有表單接上試算表與觸發器 |
| `updateFormRules()` | 把 `FN_QUESTIONS` 的必填／驗證規則套到表單 |
| `getEntryIds()` | 取得每題的 `entry.NNN`，前端表單的欄位名稱要用它 |
| `testNotify()` | 不用真的填表單，直接測兩封信 |
| `onFormSubmit(e)` | 觸發器自動呼叫，不要手動執行 |

`FormNotify.gs` 的全域名稱都有 `FN_` / `fn` 前綴。**Apps Script 所有 `.gs` 共用同一個
全域範圍**，不是各自獨立的模組，同名 `const` 會讓整個專案跑不起來。

## 維護時要注意

| 要改什麼 | 改哪裡 | 注意 |
|---|---|---|
| 表單欄位 | Google 表單 **和** `index.html` 的 `name="entry.NNN"` | 兩邊都要改；編號用 `getEntryIds()` 取得 |
| 下拉選項文字 | Google 表單 **和** `index.html` 的 `<option>` | **必須逐字相同**，否則 Google 會默默拒收那一筆 |
| 必填／驗證 | `FN_QUESTIONS` → 執行 `updateFormRules()` | 前端的 `required` 也要同步 |
| 信件內容 | `fnLeadMailHtml` / `fnOwnerMailHtml` | |
| 通知收件人 | `FN_OWNER_EMAIL` | |
| 優惠截止日 | `index.html` 的 `deadline` | 倒數與兩處「剩 N 天」都會自動跟著算 |

表單開了「收集電子郵件地址」，所以要額外送一個固定名稱的 `emailAddress` 欄位，
前端在送出時從聯絡信箱同步過去。

## 送出方式：不要改回 JavaScript 跨域請求

落地頁曾經用自己的表單直接打 Apps Script 網頁應用程式的 `/exec`，在 iOS Safari 上
**四種送出方式全部失敗**：`fetch` POST、iframe 表單 POST、JSONP、整頁導向。
同一支手機直接在網址列開 `/exec` 卻完全正常，而試算表一筆都沒進。

兩個關鍵差異讓現在這版可行：

1. **POST 的對象是 `docs.google.com/.../formResponse`**，不是 Apps Script 的 `/exec`
2. **用瀏覽器原生的表單送出**，不是腳本發起的跨域請求

另外，無法讀取回應時不要假設成功。先前的 `no-cors` 重送在讀不到回應時顯示「確認信已
寄出」，但實際上一筆都沒寫進去 —— 畫面綠燈、後台全空，比直接報錯更難查。

## 效能

這頁曾經在約 20 人同時進站時整群卡住，所以加任何資源前請先算一次進站成本。

1. **不要再把自動播放的影片放進首屏**。原本的進站全螢幕影片彈窗就是那次事故的主因，已移除。
2. **所有 mp4 必須開啟 faststart**（`moov` atom 置於 `mdat` 之前），否則瀏覽器要下載
   完整支影片才能播出第一格。修正：`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`
3. **不要把照片存成 PNG**。滿版圖一律 WebP + JPEG fallback，用 `<picture>` 包起來。
4. **每個影片都要同時提供 WebM 與 MP4**。只給單一格式時，碰上不支援該編碼的瀏覽器就沒有退路。
5. **頁面中段的防護網影片維持 `preload="none"` + IntersectionObserver**，捲到才載入。

實測（行動版、20 個分頁同時開）：每人 0.34 MB，單頁 load 中位數 0.69 秒，
20 人合計 6.9 MB，表單 20/20 正常出現。
