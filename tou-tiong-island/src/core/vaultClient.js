/**
 * 保存代碼的前端客戶端。
 *
 * 加解密都在這台裝置上做（src/core/vault.js），這裡只負責把密文送出去、拿回來。
 * 任何時候都不會把密碼或明文存檔交給伺服器。
 */
import { seal, unseal, verifierFor, makeCode, normaliseCode } from './vault.js';

const BASE = '/api/v1/vault';
const TIMEOUT_MS = 12000;

async function call(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw Object.assign(new Error(data.message ?? '連不上伺服器'), { code: data.error, status: res.status });
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('伺服器沒有回應，請稍後再試。');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 這個站台的備份是不是真的存得住（Netlify Blobs 沒開就不是）。 */
export async function isDurable() {
  try { return Boolean((await call('/status')).durable); } catch { return false; }
}

/**
 * 上傳一份新的備份。
 * @returns {{ code: string, updated_at: string, durable: boolean }}
 */
export async function backup(plaintext, password, existingCode = null) {
  let code = makeCode();
  let salt = null;
  if (existingCode) {
    code = normaliseCode(existingCode);
    if (!code) throw new Error('代碼看起來不對。格式是 TTI-XXXX-XXXX。');
    // 沿用原本的 salt，verifier 才對得上；密碼不對的話伺服器會回 409 擋下來
    try { salt = (await call(`/${code}`)).salt; } catch (e) { if (e.status !== 404) throw e; }
  }
  const sealed = await seal(plaintext, password, salt);
  try {
    const out = await call(`/${code}`, { method: 'PUT', body: JSON.stringify(sealed) });
    return { ...out, code };
  } catch (e) {
    if (e.code === 'wrong_password') throw new Error('這組代碼已經有備份了，但密碼不對，不能覆蓋。');
    throw e;
  }
}

/** 用代碼＋密碼取回存檔。回傳的是明文 JSON 字串。 */
export async function restore(codeInput, password) {
  const code = normaliseCode(codeInput);
  if (!code) throw new Error('代碼看起來不對。格式是 TTI-XXXX-XXXX。');
  let payload;
  try {
    payload = await call(`/${code}`);
  } catch (e) {
    if (e.status === 404) throw new Error('找不到這組代碼的備份。請確認有沒有抄錯。');
    throw e;
  }
  return { code, plaintext: await unseal(payload, password) };
}

/** 覆蓋同一組代碼時要附上的憑據（伺服器用來擋掉不知道密碼的人）。 */
export async function verifierForCode(codeInput, password) {
  const code = normaliseCode(codeInput);
  if (!code) throw new Error('代碼看起來不對。');
  return verifierFor(await call(`/${code}`), password);
}
