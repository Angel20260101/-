# english-lesson-bot

每週日自動把一集英語 podcast 變成一份英語課，寄到你的 Gmail：

```
RSS 最新一集  →  LLM 產生課程內容  →  ElevenLabs 合成語音  →  Gmail 寄出（HTML 信 + lesson.mp3）
```

這是原本 n8n 流程的程式版。跑在 GitHub Actions 上，**你的電腦不用開機、不用防睡眠、不用 pm2**。

---

## 一、你需要準備三組金鑰

| 用途 | 去哪裡拿 | 費用 |
|---|---|---|
| LLM | [aistudio.google.com](https://aistudio.google.com) → Get API key | Gemini Flash 有免費額度，不用綁卡 |
| 語音 | [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys | 免費方案每月額度有限 |
| 寄信 | Google 帳號 → [應用程式密碼](https://myaccount.google.com/apppasswords) | 免費 |

> **Gmail 一定要用「應用程式密碼」**，不是你的 Google 登入密碼。要先開啟兩步驟驗證才會出現這個選項。產生出來是 16 個字母（像 `abcd efgh ijkl mnop`），空格可以直接貼上，程式會自己去掉。

## 二、填進 GitHub Secrets

到 repo 的 **Settings → Secrets and variables → Actions → Secrets → New repository secret**，建立這五個：

| Secret 名稱 | 值 |
|---|---|
| `LLM_API_KEY` | 你的 Gemini API key |
| `ELEVENLABS_API_KEY` | 你的 ElevenLabs API key |
| `GMAIL_USER` | 寄信的 Gmail 帳號，例如 `you@gmail.com` |
| `GMAIL_APP_PASSWORD` | 上面那組 16 碼應用程式密碼 |
| `MAIL_TO` | 收信地址（可以跟 `GMAIL_USER` 一樣） |

**金鑰只貼在 Secrets 裡，不要寫進任何檔案、也不要貼在對話或 issue 裡。**

## 三、第一次試跑

到 **Actions → Weekly English Lesson → Run workflow**：

1. 先勾 **dry_run** 跑一次 → 不會寄信，跑完在頁面下方 Artifacts 下載 `lesson-preview`，打開 `lesson.html` 看版面和內容對不對。
2. 滿意了，不勾 dry_run 再跑一次 → 信會寄到 `MAIL_TO`。

之後就會**每週日台北時間 20:05 自動跑**。

> 排程設成 20:05 而不是你說的 20:00：GitHub 的排程在整點會大排隊，常常延遲十幾分鐘，挑個非整點的分鐘反而更準。要改成剛好 20:00 的話，把 `.github/workflows/english-lesson.yml` 裡的 `cron: '5 12 * * 0'` 改成 `'0 12 * * 0'`（cron 是 UTC，台北時間要減 8 小時）。

## 四、想調整內容（不用改程式）

到 **Settings → Secrets and variables → Actions → Variables** 新增，留空就用預設值：

| Variable | 預設 | 說明 |
|---|---|---|
| `PODCAST_RSS_URL` | BBC 6 Minute English | 換成你想聽的 podcast RSS |
| `LESSON_LEVEL` | `B1-B2` | CEFR 程度 |
| `NATIVE_LANGUAGE` | `繁體中文` | 翻譯和解釋用的語言 |
| `VOCAB_COUNT` | `8` | 單字數量 |
| `PHRASE_COUNT` | `5` | 片語數量 |
| `QUESTION_COUNT` | `3` | 理解題數量 |
| `MAX_EPISODE_AGE_DAYS` | `14` | 最新一集超過這天數就不寄（避免寄到舊內容） |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM`（Rachel） | 換聲音 |
| `TTS_MAX_CHARS` | `2500` | 語音字數上限，保護免費額度 |
| `TTS_ENABLED` | `true` | 設 `false` 就只寄文字不合成語音 |
| `LLM_PROVIDER` | `gemini` | 可換 `groq` 或 `openai` |
| `LLM_MODEL` | 各家預設 | 想指定特定模型時填 |
| `MAIL_SUBJECT_PREFIX` | `🎧 本週英語課` | 信件主旨開頭 |

### 換 LLM 供應商

只要改兩個地方，程式不用動：

- 用 Groq：`LLM_PROVIDER=groq`（Variable），`LLM_API_KEY` 換成 Groq 的 key
- 用 OpenAI：`LLM_PROVIDER=openai`，`LLM_API_KEY` 換成 OpenAI 的 key

Gemini 的模型名稱常改版，所以程式有保險：如果設定的模型被拒絕，會自動問 API 你的 key 能用哪些模型，挑一個 Flash 重試。

## 五、設計上刻意的幾件事

- **語音失敗不會讓整封信寄不出去。** ElevenLabs 額度用完或出錯時，程式印警告、改寄純文字信，並把英語講解稿直接放在信裡讓你自己念。
- **同一集不會重複寄。** 寄成功後會把集數 ID 寫進 `state/last-episode.json` 並 commit 回 repo。下週如果 podcast 還沒更新，就不寄信、不報錯。想強制重寄，手動跑 workflow 時勾 `ignore_state`。
- **每次自動跑之前會先跑測試**，程式壞掉時不會寄出壞內容。
- **信件是 inline style 的 HTML**，Gmail 會把 `<style>` 區塊丟掉，所以樣式全部寫在標籤上。
- **所有外部文字都做 HTML escape**，shownotes 裡的 `<` `&` 不會弄壞版面。

## 六、在自己電腦上跑（選用，不是必須）

```bash
cd english-lesson-bot
npm install
cp .env.example .env     # 把金鑰填進 .env
node --env-file=.env src/index.js           # 真的寄信
DRY_RUN=1 node --env-file=.env src/index.js # 只產生 out/lesson.html，不寄信
npm test                                     # 跑測試（不需要金鑰、不連網）
```

`.env` 已經在 `.gitignore` 裡，不會被 commit。

## 七、檔案結構

```
english-lesson-bot/
├── src/
│   ├── index.js    流程主控：抓 RSS → 產生課程 → 合成語音 → 寄信 → 寫狀態
│   ├── config.js   所有設定值與預設值，全部從環境變數讀
│   ├── rss.js      抓取與解析 RSS、挑選要用哪一集
│   ├── llm.js      可切換的 LLM 轉接層（Gemini / Groq / OpenAI）
│   ├── lesson.js   課程 prompt、JSON 解析與欄位清理
│   ├── tts.js      ElevenLabs 語音合成（失敗回傳 null，不丟錯）
│   ├── render.js   HTML 與純文字信件版面
│   ├── email.js    Gmail SMTP 寄送
│   └── state.js    讀寫「上次寄了哪一集」
├── test/           17 個測試，全部離線跑
├── state/          上次寄出的集數紀錄（由 Actions 自動 commit）
└── .env.example    本地執行用的環境變數範本
```

排程設定在 repo 根目錄的 `.github/workflows/english-lesson.yml`。

## 八、出問題時怎麼看

到 **Actions** 點進失敗的那次執行，看 "Generate and send the lesson" 這一步的 log。常見訊息：

| log 訊息 | 意思 |
|---|---|
| `Nothing to send: the newest episode ... was already sent` | podcast 這週沒更新，正常，不是錯誤 |
| `Nothing to send: ... past MAX_EPISODE_AGE_DAYS` | 這個 feed 很久沒更新，調大 `MAX_EPISODE_AGE_DAYS` 或換 feed |
| `[warn] ElevenLabs failed: 401` | ElevenLabs key 錯了或額度用完，信照寄但沒有 mp3 |
| `Gemini request failed: 429` | 免費額度達上限，隔天會重置 |
| `Invalid login` / `535` | Gmail 用了登入密碼而不是應用程式密碼 |
| `Missing required environment variables` | Secrets 有漏填 |
