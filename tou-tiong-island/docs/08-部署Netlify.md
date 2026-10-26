# 08｜部署到 Netlify（GitHub 自動上傳）

## 架構

```
GitHub（Angel20260101/-）
   │  push 到任一分支
   ▼
Netlify 自動建置
   │  base = tou-tiong-island
   │  command = npm run build   ← 會先跑 npm test，沒過就不部署
   │  publish = dist
   ▼
線上網址（含 Netlify Functions）
```

這個 repo 根目錄另有一個 GitHub Pages 的行銷頁（`index.html`），
`netlify.toml` 用 `base` 指定建置目錄，兩邊互不影響。

## 第一次設定

1. 到 <https://app.netlify.com> → **Add new site** → **Import an existing project**。
2. 選 GitHub，授權後挑這個 repo。
3. 建置設定**不用手動填**——根目錄的 `netlify.toml` 已經寫好：

   ```toml
   [build]
     base      = "tou-tiong-island"
     command   = "npm run build"
     publish   = "dist"
     functions = "netlify/functions"

   [build.environment]
     NODE_VERSION = "22"

   [functions]
     node_bundler = "esbuild"
   ```

4. **Deploy site**。第一次約 1–2 分鐘。

之後每次 push 到 GitHub，Netlify 會自動建置並部署。Pull request 會得到獨立的 Deploy Preview。

## 環境變數

在 Netlify 的 **Site configuration → Environment variables** 設定：

| 變數 | 必要 | 說明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 否 | 不設定的話 AI 回饋全部走固定文案，遊戲完全正常 |
| `TTI_AI_MODEL` | 否 | 覆寫使用的模型，預設讀 `content/ai_feedback.json` 的 `model.preferred` |
| `TTI_AI_DISABLED` | 否 | 設為 `1` 強制全部走固定文案（維運開關，不用重新部署） |

**先不設 API key 也可以上線**：18 條航線都有預先寫好的回饋，玩家看到的畫面一樣，
只多一行「這次用的是預先寫好的版本」。

## 設定檔做了什麼

```toml
# 單頁應用：所有前端路徑都回到 index.html
[[redirects]]
  from = "/*"
  to   = "/index.html"
  status = 200
  force = false          # 不覆蓋 Functions 與實體檔案

# 靜態資源長期快取（檔名帶 hash），index.html 不快取
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache"

# 安全標頭
[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(), microphone=(), camera=()"
```

## Functions

| 路徑 | 檔案 | 說明 |
|---|---|---|
| `/.netlify/functions/ai-feedback` | `netlify/functions/ai-feedback.mjs` | AI 個人化回饋 |
| `/api/v1/*` | `netlify/functions/api.mjs` | 後端 REST API（參考實作） |

`api.mjs` 預設用行程內記憶體儲存，Netlify Function 會被回收，所以**只適合開發與示範**。
正式環境請依 `docs/06` 的 PostgreSQL schema 實作 `Store` 介面並接上資料庫
（Neon、Supabase、Netlify DB 都可以），呼叫端不用改。

前端預設完全獨立運作（匿名、localStorage），不接後端也能完整遊玩。

## 本機開發

```bash
cd tou-tiong-island
npm install
npm run dev          # http://localhost:5173
```

要連 Functions 一起跑：

```bash
npx netlify dev      # 需要 Netlify CLI
```

## 部署前檢查

`npm run build` 會先跑 `npm run validate`，劇情資料有問題就不會產生 `dist`，
Netlify 也就不會部署壞掉的版本。建議在本機先跑完整測試：

```bash
npm test
```

## 自訂網域與 HTTPS

Netlify 預設給 `<site-name>.netlify.app`，憑證自動申請。
要換網域：**Domain management → Add a domain**，照畫面指示設 DNS。

## 回滾

Netlify 保留每次部署。**Deploys** 頁面點任一次舊版 → **Publish deploy** 即可立刻回滾，
不需要 revert commit。
