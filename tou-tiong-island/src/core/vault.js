/**
 * 保存代碼（E8）。
 *
 * 問題：紀錄只存在這台裝置的 localStorage，換手機、清快取就全部不見。
 * 作法：玩家拿到一組代碼、自己設一個密碼，整份存檔在**瀏覽器裡**加密完才上傳；
 *       伺服器只收得到一團密文，沒有密碼就解不開，也沒有任何帳號可以對應到人。
 *
 * 金鑰推導一次產生 64 bytes，前 32 當 AES-GCM 金鑰、後 32 當 verifier。
 * PBKDF2 的兩個區塊彼此算不出來，所以伺服器存了 verifier 也推不回金鑰。
 * verifier 的用途只有一個：別人就算知道你的代碼，也不能覆蓋掉你的備份。
 *
 * 密碼忘記就真的沒救——這是加密的代價，介面上必須講清楚。
 */
const ITERATIONS = 150_000;
const KEY_BITS = 512;            // 256 給 AES、256 給 verifier

// 去掉 0/O/1/I/L：手抄代碼最容易抄錯的就是這幾個
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^TTI-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();

const subtle = () => {
  const c = globalThis.crypto?.subtle;
  // http:// 下（非 localhost）沒有 WebCrypto，只能走備份檔那條路
  if (!c) throw new Error('這個瀏覽器環境不支援加密，請改用「下載備份檔」。');
  return c;
};

export function makeCode() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `TTI-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** 使用者會手打，所以大小寫、空白、缺少的連字號都要容忍。 */
export function normaliseCode(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('TTI') ? raw.slice(3) : raw;
  if (body.length !== 8) return null;
  const code = `TTI-${body.slice(0, 4)}-${body.slice(4)}`;
  return CODE_RE.test(code) ? code : null;
}

export const isValidCode = (s) => CODE_RE.test(String(s ?? ''));

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt) {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, KEY_BITS,
  );
  const all = new Uint8Array(bits);
  const key = await subtle().importKey('raw', all.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, verifier: b64(all.slice(32)) };
}

/**
 * 把存檔加密成可以上傳的樣子。
 *
 * 覆蓋同一組代碼時必須沿用原本的 salt（傳 existingSalt），否則推出來的 verifier
 * 跟伺服器存的那份對不起來，連密碼正確的本人都會被擋在外面。IV 每次都重新產生。
 * @returns {{ v:number, salt:string, iv:string, ct:string, verifier:string }}
 */
export async function seal(plaintext, password, existingSalt = null) {
  const salt = existingSalt ? unb64(existingSalt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const { key, verifier } = await derive(password, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), verifier };
}

/** 解開伺服器拿回來的密文。密碼錯會丟錯，訊息要讓人看得懂。 */
export async function unseal(payload, password) {
  const salt = unb64(payload.salt);
  const { key } = await derive(password, salt);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.ct),
    );
    return dec.decode(plain);
  } catch {
    throw new Error('密碼不對，或這組代碼的備份已經換過了。');
  }
}

/** 覆蓋既有備份時要附上的憑據；伺服器拿它比對，但推不回金鑰。 */
export async function verifierFor(payload, password) {
  const { verifier } = await derive(password, unb64(payload.salt));
  return verifier;
}
