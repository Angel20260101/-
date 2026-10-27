/**
 * 本機存檔。
 *
 * 預設匿名：不需要帳號，也不產生任何可識別個人的資料。player_id 只存在這台
 * 裝置的 localStorage 裡，用於串接同一個人的多次遊玩，不會送到 AI 服務。
 * 後端同步（docs/06）是選配，介面與這裡一致，所以之後接上雲端不用改呼叫端。
 */
const KEY = 'tti.save.v1';
export const SAVE_VERSION = '1.0.0';

const todayKey = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

/** ISO 8601 週次，給每週任務判斷「這週做過沒」。 */
export function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const dateKey = todayKey;

export function emptySave() {
  const now = Date.now();
  return {
    save_version: SAVE_VERSION,
    player_id: `anon_${Math.random().toString(36).slice(2, 10)}`,
    created_at: now,
    updated_at: now,
    islands: {},
    daily: {},
    weekly: [],
    keepsakes: [],
    cards: [],
    letters: [],
    wishes: [],
    active_session: null,
    settings: { ai_feedback_consent: null, reduce_motion: false, trust_seen: false },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const data = JSON.parse(raw);
    if (data.save_version !== SAVE_VERSION) return migrate(data);
    return { ...emptySave(), ...data };
  } catch {
    return emptySave();
  }
}

export function save(state) {
  state.updated_at = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // 無痕模式或空間不足：遊戲照常進行，只是不留紀錄
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}

/** 舊版存檔升級。目前只有 1.0.0，保留這個位置讓之後加欄位時不會弄丟玩家資料。 */
function migrate(old) {
  return { ...emptySave(), ...old, save_version: SAVE_VERSION };
}

export function exportSave(state) {
  return JSON.stringify(state, null, 2);
}

export function importSave(json) {
  const data = JSON.parse(json);
  if (!data.save_version) throw new Error('不是有效的存檔檔案');
  return migrate(data);
}
