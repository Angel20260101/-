# 06｜後端資料結構、API 與隱私規範

## 設計原則

1. **資料驅動的共用劇情引擎**。新增故事只要新增一份 JSON，不改程式。
2. **前後端共用同一套引擎**。`src/core/` 的 `expr.js`、`storyEngine.js`、`routeResolver.js`
   是純函式、無副作用、不依賴瀏覽器；前端、驗證器、後端 Node 服務直接 import 同一份檔案。
   同一組選擇在兩邊得到同一條航線——這件事由 `tools/api-cases.mjs` 每次 CI 驗證。
3. **預設匿名**。不需要帳號就能玩，`player_id` 是裝置端產生的匿名識別碼。
4. **個人資料不給雇主**。見下方「隱私規範」。

## 資料流

```
                     content/*.json（劇本、島嶼、練習卡、任務文案）
                                    │  唯一真實來源
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         前端（瀏覽器，localStorage）      後端（Netlify Function ＋ DB，選配）
                    │                               │
                    └───────── src/core/ ───────────┘
                         同一套劇情引擎與航線判定
```

**前端可以完全獨立運作**（匿名、本機存檔），後端是選配的雲端同步與統計層。

## 資料庫 Schema（PostgreSQL）

```sql
-- ── 玩家（匿名） ──────────────────────────────────────────
CREATE TABLE players (
  player_id     TEXT PRIMARY KEY,                  -- 'anon_xxxxxxxx'，裝置端產生
  org_id        TEXT,                              -- 選配：所屬組織，僅供彙總統計
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb -- ai_feedback_consent 等
);
-- 刻意沒有 email、姓名、員工編號、部門、職稱欄位。

-- ── 劇本版本（內容治理） ──────────────────────────────────
CREATE TABLE stories (
  story_id      TEXT NOT NULL,
  version       TEXT NOT NULL,                     -- semver，劇本改動必須升版
  schema_version TEXT NOT NULL,
  island_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  theme         TEXT NOT NULL,
  document      JSONB NOT NULL,                    -- 完整 story JSON
  published_at  TIMESTAMPTZ,
  retired_at    TIMESTAMPTZ,
  PRIMARY KEY (story_id, version)
);
CREATE INDEX stories_published ON stories (story_id) WHERE retired_at IS NULL;

-- ── 遊玩階段 ──────────────────────────────────────────────
CREATE TABLE play_sessions (
  session_id      TEXT PRIMARY KEY,                -- 'sess_xxx'
  player_id       TEXT NOT NULL REFERENCES players,
  story_id        TEXT NOT NULL,
  story_version   TEXT NOT NULL,                   -- 開始時的版本，中途改版不影響進行中的場次
  status          TEXT NOT NULL CHECK (status IN ('in_progress','completed','abandoned')),
  current_node_id TEXT NOT NULL,
  vars            JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags            JSONB NOT NULL DEFAULT '{}'::jsonb,
  ending_id       TEXT,
  route_id        TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  FOREIGN KEY (story_id, story_version) REFERENCES stories (story_id, version)
);
CREATE INDEX play_sessions_resume ON play_sessions (player_id, status)
  WHERE status = 'in_progress';                    -- 中斷恢復用

-- ── 選擇紀錄（每個決策點一列） ────────────────────────────
CREATE TABLE play_choices (
  session_id  TEXT NOT NULL REFERENCES play_sessions ON DELETE CASCADE,
  seq         INT  NOT NULL,                       -- 1, 2, 3...
  node_id     TEXT NOT NULL,
  choice_id   TEXT NOT NULL,
  clue_id     TEXT NOT NULL,
  chosen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seq)
);

-- ── 島嶼進度 ──────────────────────────────────────────────
CREATE TABLE island_progress (
  player_id         TEXT NOT NULL REFERENCES players ON DELETE CASCADE,
  island_id         TEXT NOT NULL,
  unlocked          BOOLEAN NOT NULL DEFAULT false,
  display_name      TEXT,                          -- 玩家自取，最多 12 字
  discovered_routes TEXT[] NOT NULL DEFAULT '{}',  -- route_id 陣列，不重複
  plays             INT  NOT NULL DEFAULT 0,
  endings           JSONB NOT NULL DEFAULT '{}'::jsonb, -- { ending_id: 次數 }
  first_completed_at TIMESTAMPTZ,
  last_played_at     TIMESTAMPTZ,
  PRIMARY KEY (player_id, island_id)
);

-- ── 每日天氣心情打卡 ──────────────────────────────────────
CREATE TABLE daily_checkins (
  player_id  TEXT NOT NULL REFERENCES players ON DELETE CASCADE,
  date       DATE NOT NULL,                        -- 玩家本地日期
  mood_id    TEXT NOT NULL,
  energy     SMALLINT CHECK (energy BETWEEN 1 AND 5),   -- 已停用：打卡改成一鍵三選一
  note       TEXT CHECK (char_length(note) <= 140),       -- 已停用：同上，沒有自填欄位
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, date)                    -- 同一天可以改，不會多一列
);

-- ── 每週心情溫度計 ────────────────────────────────────────
CREATE TABLE weekly_thermometer (
  player_id      TEXT NOT NULL REFERENCES players ON DELETE CASCADE,
  week           TEXT NOT NULL,                    -- ISO 週次，'2026-W44'
  instrument_id  TEXT NOT NULL,                    -- 'bsrs5'
  answers        JSONB NOT NULL,                   -- { b1: 0-4, ... b5: 0-4 }
  score          SMALLINT NOT NULL,                -- 前 5 題總分 0-20；不顯示給玩家
  band_id        TEXT NOT NULL,                    -- good / mild / moderate / severe
  safety_flagged BOOLEAN NOT NULL DEFAULT false,   -- 附加題 b6 >= 2；不計入 score
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, week)
);

-- ── 保存代碼（E8）─────────────────────────────────────────
-- 整張表只有密文。沒有 player_id、沒有任何可以對應到人的欄位，
-- 伺服器也沒有密碼，所以就算整張表外洩也解不開。
CREATE TABLE vault (
  code       TEXT PRIMARY KEY,                     -- 'TTI-XXXX-XXXX'
  v          SMALLINT NOT NULL DEFAULT 1,
  salt       TEXT NOT NULL,                        -- base64，PBKDF2 用
  iv         TEXT NOT NULL,                        -- base64，AES-GCM 用
  ct         TEXT NOT NULL,                        -- base64 密文，上限 512 KB
  verifier   TEXT NOT NULL,                        -- 只用來擋覆蓋；GET 不回傳
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 收藏 ──────────────────────────────────────────────────
CREATE TABLE collections (
  player_id   TEXT NOT NULL REFERENCES players ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('practice_card','keepsake')),
  item_id     TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, kind, item_id)
);

-- ── AI 回饋紀錄（只給玩家本人看） ─────────────────────────
CREATE TABLE ai_feedback_log (
  feedback_id   TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES play_sessions ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('ai','fallback')),
  model         TEXT,
  fallback_reason TEXT,
  response      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 不儲存 player_note 原文。送進模型的那一份用完即丟。
```

### 索引與保存期限建議

| 表 | 保存期限 | 說明 |
|---|---|---|
| `play_sessions` / `play_choices` | 365 天 | 超過自動刪除，島嶼進度不受影響 |
| `daily_checkins` | 玩家自選（預設 2 年） | 玩家可隨時整批刪除 |
| `weekly_thermometer` | 玩家自選（預設 2 年） | 同上 |
| `ai_feedback_log` | 90 天 | 只為了讓玩家回頭看，不做分析 |

## REST API

Base path：`/api/v1`　・　參考實作：[`netlify/functions/api.mjs`](../netlify/functions/api.mjs)

### 內容

| Method | Path | 說明 |
|---|---|---|
| GET | `/content/stories` | 故事索引（含版本、航線名稱、結局數、內容提醒） |
| GET | `/content/stories/:story_id` | 完整 story JSON |
| GET | `/content/islands` | 群島佈局與養成資料 |
| GET | `/content/practice-cards` | 18 張情緒練習卡 |
| GET | `/content/tasks` | 每日／每週任務文案與安全資源 |

### 遊玩

| Method | Path | 說明 |
|---|---|---|
| POST | `/sessions` | 開始一次遊玩。Body：`{ player_id, story_id }` → `201` ＋ session ＋ 開場節點 |
| GET | `/sessions/:id` | 取回目前狀態與節點內容（**中斷恢復**） |
| POST | `/sessions/:id/advance` | 推進非決策節點。走到結局時回傳 `{ ending, route }` |
| POST | `/sessions/:id/choices` | 送出選擇。Body：`{ choice_id }` → 立即反應、心聲線索、實際後果 |
| POST | `/sessions/:id/complete` | 結算：結局回顧、航線、練習卡、島嶼成長、重玩提示 |

`advance` 與 `choices` 都會把狀態寫回去，所以任何一步離開都能接續。
`complete` 是獨立一步——沒有呼叫就不會寫進島嶼進度。

### 玩家

| Method | Path | 說明 |
|---|---|---|
| GET | `/players/:pid/progress` | 六座島的解鎖狀態、名稱、已發現航線、遊玩次數 |
| PATCH | `/players/:pid/islands/:island_id` | 島嶼命名。Body：`{ name }`。未解鎖回 `409` |
| POST | `/players/:pid/checkins` | 每日打卡。Body：`{ date, mood_id, energy?, note? }` |
| GET | `/players/:pid/checkins?from=&to=` | 查詢期間內的打卡紀錄 |
| POST | `/players/:pid/thermometer` | 每週溫度計。Body：`{ week, answers, safety_value? }` |
| GET | `/players/:pid/thermometer` | 歷次紀錄 |

### 其他

| Method | Path | 說明 |
|---|---|---|
| POST | `/.netlify/functions/ai-feedback` | AI 個人化回饋（見 `docs/05`） |
| GET | `/insights/team?from=&to=` | 團隊彙總統計，**低於 k 匿名門檻一律不回傳** |
| GET | `/health` | 健康檢查 |

### 錯誤格式

```jsonc
{ "error": "session_not_found", "message": "找不到這個遊玩階段" }
```

| 代碼 | HTTP | 情況 |
|---|---|---|
| `invalid_json` | 400 | 請求內容不是合法 JSON |
| `invalid_request` | 400 | 缺少必填欄位或值不合法 |
| `invalid_choice` | 400 | 這個節點沒有這個選項 |
| `story_not_found` | 404 | 找不到故事 |
| `session_not_found` | 404 | 找不到遊玩階段 |
| `not_found` | 404 | 未知路徑 |
| `already_completed` | 409 | 已結束的場次再送選擇 |
| `not_finished` | 409 | 還沒走到結局就要結算 |
| `island_locked` | 409 | 未解鎖的島不能命名 |
| `server_error` | 500 | 其他 |

### 範例：從開始到結算

```bash
# 1. 開始
curl -XPOST $BASE/api/v1/sessions -H 'Content-Type: application/json' \
  -d '{"player_id":"anon_demo","story_id":"story_01_late_message"}'
# → 201 { "session": { "session_id": "sess_...", "current_node_id": "n_01_open" },
#          "node": { "node_id": "n_01_open", "dialogue": [ ... ] } }

# 2. 推進到決策點
curl -XPOST $BASE/api/v1/sessions/$SID/advance

# 3. 送出選擇
curl -XPOST $BASE/api/v1/sessions/$SID/choices -H 'Content-Type: application/json' \
  -d '{"choice_id":"c_01_d1_tomorrow"}'
# → 200 { "immediate": [...], "inner_voice_clue": { "title": "心聲線索", "text": "..." },
#          "consequence": "你把時間劃回上班時段⋯⋯", "next_node_id": "n_01_b1" }

# 4. 一直 advance 到結局
# → 200 { "ending": { "ending_id": "e_01_line" }, "route": { "route_id": "r_01_boundary" } }

# 5. 結算
curl -XPOST $BASE/api/v1/sessions/$SID/complete
# → 200 { "recap": {...}, "practice_card": {...},
#          "island": { "first_play": true, "new_route": true, "discovered": 1, "total": 3,
#                      "growth": { "label": "界線石徑", "unlock_line": "..." } } }
```

## 儲存層抽象

`netlify/functions/api.mjs` 把儲存抽成 `Store` 介面，預設是行程內記憶體實作
（Netlify Function 會被回收，只適合開發與示範）。換成 PostgreSQL 時只要實作同樣這幾個
async 方法，呼叫端完全不用改：

```js
createSession(row) / getSession(id) / updateSession(row)
getProgress(playerId) / saveProgress(row)
putCheckin(row) / listCheckins(playerId, from, to)
putWeekly(row) / listWeekly(playerId)
aggregate({ from, to })
```

保存代碼另外走 `VaultStore`（`durable()` / `get(code)` / `put(code, row)`），
因為它存的是不透明密文，跟上面這些有結構的資料表性質不同。

## 保存代碼（E8）

紀錄預設只存在瀏覽器的 localStorage，清快取或換手機就會消失。E8 提供兩條帶走的路，
兩條都不需要帳號、不需要 email。

### 一、備份檔

`state.exportJSON()` 匯出純 JSON，讀回時走 `storage.importSave()`。
檔案在使用者自己手上，不經過伺服器，離線也能用。

### 二、保存代碼（端對端加密）

代碼格式 `TTI-XXXX-XXXX`，字母表去掉 `0 O 1 I L`，避免手抄誤判。
加解密全部在瀏覽器裡完成（`src/core/vault.js`），**伺服器只收得到密文**。

```
bits     = PBKDF2(password, salt, 150_000, SHA-256, 512 bits)
aesKey   = bits[0..32]      // AES-GCM 256，加密整份存檔
verifier = bits[32..64]     // 存在伺服器，用來擋掉「知道代碼但不知道密碼」的人
```

PBKDF2 的兩個輸出區塊彼此推不回去，所以即使資料庫整個外洩，拿到 `verifier` 也還原不出
`aesKey`。密碼不上傳、伺服器無法驗證也無法重設——**忘記密碼就真的解不開**，介面上必須講清楚。

覆蓋同一組代碼時要沿用原本的 `salt`，否則推出來的 verifier 跟伺服器存的對不上，
連本人都會被擋在外面（`seal(plaintext, password, existingSalt)`）。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/v1/vault/status` | 回 `{ durable }`。Netlify Blobs 沒開時為 `false`，介面要據實告知 |
| GET | `/api/v1/vault/:code` | 回 `{ v, salt, iv, ct, updated_at }`。**不回傳 `verifier`** |
| PUT | `/api/v1/vault/:code` | 收 `{ v, salt, iv, ct, verifier }`。已存在且 verifier 不符回 `409` |

伺服器端的防呆：只允許 `v / salt / iv / ct / verifier` 五個欄位，多一個就回 `400`
（避免哪天前端改錯方向把明文送上來）；`salt / iv / ct / verifier` 必須是 base64；
`ct` 上限 512 KB。

儲存層是 `VaultStore`，優先用 Netlify Blobs（`tti-vault`，strong consistency），
拿不到就退回記憶體並讓 `durable` 回 `false`——本機開發跑得動，但不會假裝有備份。

## 願望看板

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/v1/wishes/board` | 主題、公司回應進度（`received` / `in_progress` / `done`）、k 匿名門檻 |

內容來自 `content/wish_board.json`，正式上線時由企業端後台維護。
**使用者寫的願望原文從來不會經過這個端點**，原文只留在他自己的裝置上；
公司看到的只有主題，而且一樣要過 k 匿名門檻。

島上的樹就是照這份資料長的：`in_progress` 長樹苗、`done` 長大樹、`received` 什麼都不長。
沒有回應的主題島上就空著——這裡不替公司講好話。

## 隱私規範

### 不得提供給雇主的東西

> 個人的故事選擇、心情紀錄與 AI 回饋，不得提供給雇主辨識個別員工。

落實方式：

1. **沒有個人層級的查詢 API 給組織端**。`/insights/team` 是唯一對外的統計端點。
2. **k 匿名門檻**：`K_ANONYMITY_MIN = 10`。期間內有效樣本少於 10 人，直接回
   `{ "suppressed": true }`，不回傳任何數字。
3. **統計只到彙總層級**：人數、筆數、心情分布。沒有 `player_id`、沒有自填文字、
   沒有故事選擇、沒有航線、沒有溫度計個別答案。
4. **`players` 表沒有可識別欄位**：沒有 email、姓名、員工編號、部門、職稱。
   `org_id` 只用來決定統計的分母，不能反查成員。
5. **AI 回饋不寫入任何組織可查的資料表**，`player_note` 原文不落地。
6. **保存代碼的備份是密文**。伺服器沒有密碼，解不開，也無從得知裡面是誰的島；
   願望看板只回傳主題與公司回應，不碰任何人寫的原文。

### 玩家的資料權利

| 權利 | 做法 |
|---|---|
| 匿名使用 | 預設。不需要帳號即可完整遊玩 |
| 隨時查看 | 存檔是純 JSON，可直接匯出 |
| 刪除 | 清除本機存檔即可；接上後端時 `DELETE /players/:pid` 連動刪除所有關聯列 |
| 帶走 | 下載備份檔，或用保存代碼（端對端加密）在另一台裝置還原 |
| 選擇性同意 AI | 每次都要按按鈕；自填內容另外一道同意 |

### 送進第三方（AI 模型）的資料

只有 `schema/ai_feedback_request.schema.json` 定義的欄位，白名單在伺服器端強制執行。
心情打卡、溫度計分數、島嶼名稱、裝置資訊一律不送。詳見 `docs/05`。
