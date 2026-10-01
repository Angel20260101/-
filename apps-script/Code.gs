/*** 心情AED landing page 收單後端 ***/
/*
 * 安裝位置：Google 試算表 →「擴充功能 → Apps Script」，把本檔內容整段貼上。
 * 部署方式：「部署 → 新增部署作業 → 網頁應用程式」
 *           執行身分 = 我
 *           具有應用程式存取權的使用者 = 任何人
 * 部署後取得的 /exec 網址，填到 index.html 的 FORM_ENDPOINT。
 */

// ↓↓↓ 這一行改成你要收通知的信箱 ↓↓↓
const OWNER_EMAIL = 'may2003mary@gmail.com';

const BRAND_NAME  = '心情AED';
const SHEET_NAME  = '工作表1';   // 如果你把分頁改名了，這裡要跟著改

// 試算表 ID（網址 /spreadsheets/d/<這一段>/edit）。
// 指定 ID 之後，不論這支腳本是綁在試算表上還是獨立建立的都能運作；
// 只靠 getActiveSpreadsheet() 的話，獨立式腳本會拿到 null。
const SHEET_ID = '1l8Zn4W_KpPIMkzWlgoryzSup9tALcDpslFg7tVu0zgk';

// 每次改完這份程式碼就把日期往後更新，部署後用瀏覽器打開 /exec 即可確認
// 線上跑的是不是最新版（避免「存檔了但忘記重新部署」的情況）
const CODE_VERSION = '2026-10-01g';

// selftest 用的通行碼。網址帶上 ?selftest=<這組字串> 會實際寫入一列並寄信，
// 用來驗證「匿名訪客」走完整條路徑是否暢通。驗完可以改掉這組字串。
const SELFTEST_KEY = 'aed-check-9471';

function doPost(e) {
  return respond(processSubmission((e && e.parameter) || {}), (e && e.parameter) || {});
}

// 送出處理：doPost 與 doGet(?action=submit) 共用同一套邏輯。
// 之所以兩邊都支援，是因為有些瀏覽器／網路環境送不出跨網域 POST，
// 但同一個端點的 GET 是通的。
function processSubmission(p) {
  try {
    if (Object.keys(p).length === 0) {
      return { ok: false, error: '伺服器未收到任何表單欄位', reason: 'empty-body' };
    }

    if (p['bot-field']) {
      console.warn('honeypot 命中，值為：' + p['bot-field']);
      return { ok: true, skipped: 'honeypot', got: String(p['bot-field']).slice(0, 40) };
    }

    const sid     = clean(p.sid,     64);
    const name    = clean(p.name,    100);
    const title   = clean(p.title,   100);
    const company = clean(p.company, 200);
    const size    = clean(p.size,    50);
    const phone   = clean(p.phone,   50);
    const email   = clean(p.email,   200);
    const note    = clean(p.note,    2000);

    if (!name || !company || !phone || !email) {
      return { ok: false, error: '必填欄位未填寫完整' };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'Email 格式不正確' };
    }

    const cache  = CacheService.getScriptCache();
    const sidKey = sid ? 'sid_' + sid : null;
    if (sidKey && cache.get(sidKey)) return { ok: true, duplicate: true };

    const now = new Date();

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (err) {
      return { ok: false, error: '系統忙碌中，請稍後再送出一次' };
    }
    try {
      if (sidKey && cache.get(sidKey)) return { ok: true, duplicate: true };
      const target = getSheet();
      target.sheet.appendRow([now, name, title, company, size, phone, email, note, '未聯繫']);
      if (sidKey) cache.put(sidKey, '1', 21600);
      var lastRow  = target.sheet.getLastRow();
      var sheetUrl = target.ss.getUrl();
    } finally {
      lock.releaseLock();
    }

    var mailOwner = false, mailLead = false, mailError = '';
    try {
      MailApp.sendEmail({
        to: OWNER_EMAIL,
        subject: '【' + BRAND_NAME + '】新名單：' + company + ' / ' + name,
        htmlBody: ownerMailHtml({
          name: name, title: title, company: company, size: size,
          phone: phone, email: email, note: note,
          time: Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
          sheetUrl: sheetUrl
        })
      });
      mailOwner = true;
    } catch (err) {
      mailError += 'owner: ' + err + '; ';
      console.error('通知信寄送失敗：' + err);
    }

    try {
      MailApp.sendEmail({
        to: email,
        subject: '【' + BRAND_NAME + '】已收到您的諮詢需求，我們將於 1 個工作日內與您聯繫',
        htmlBody: leadMailHtml({ name: name, company: company, size: size, note: note })
      });
      mailLead = true;
    } catch (err) {
      mailError += 'lead: ' + err + '; ';
      console.error('自動回覆信寄送失敗：' + err);
    }

    return {
      ok: true,
      row: lastRow,
      mailOwner: mailOwner,
      mailLead: mailLead,
      mailError: mailError || undefined,
      quotaRemaining: mailQuota(),
      version: CODE_VERSION
    };

  } catch (err) {
    console.error(err);
    return { ok: false, error: '伺服器處理失敗', detail: String(err) };
  }
}

// 回應格式：iframe 送出時回一個會用 postMessage 把結果傳回母頁面的 HTML，
// 這樣即使跨網域，前端也讀得到伺服器真正的回應。其餘情況回 JSON。
function respond(result, p) {
  p = p || {};

  // JSONP：<script src="..."> 載入，瀏覽器直接執行回傳的 JavaScript。
  // script 是子資源而非第三方框架，Safari 的追蹤防護不會擋，也不受 CORS 規範，
  // 而且前端拿得到伺服器真正的回應。這是最可靠的一條路。
  if (p.callback) {
    var cb = String(p.callback).replace(/[^A-Za-z0-9_$]/g, '');   // 只允許安全的識別字
    if (!cb) cb = 'aedCallback';
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // 整頁導向送出：處理完直接把瀏覽器送回落地頁，並帶上結果。
  // 這是最後手段，但保證可用 —— 它就是一般的網頁瀏覽。
  if (p.redirect) {
    var back = String(p.redirect);
    if (!/^https:\/\/[A-Za-z0-9.-]+\//.test(back)) {
      return jsonOut({ ok: false, error: 'redirect 網址格式不正確' });
    }
    var sep  = back.indexOf('?') >= 0 ? '&' : '?';
    var dest = back + sep + 'sent=' + (result.ok ? '1' : '0') + '#contact-form';
    return HtmlService
      .createHtmlOutput('<!doctype html><meta charset="utf-8">'
        + '<meta http-equiv="refresh" content="0;url=' + dest.replace(/"/g, '&quot;') + '">'
        + '<p>處理完成，正在返回…　<a href="' + dest.replace(/"/g, '&quot;') + '">若未自動返回請點此</a></p>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (p.mode === 'iframe') {
    var payload = JSON.stringify(result).replace(/</g, '\\u003c');
    var html =
      '<!doctype html><meta charset="utf-8"><body>' +
      '<script>' +
      'var r = ' + payload + ';' +
      'try { parent.postMessage({ source: "aed-form", result: r }, "*"); } catch (e) {}' +
      '</scr' + 'ipt>' +
      '<pre>' + payload.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>' +
      '</body>';
    return HtmlService.createHtmlOutput(html)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return jsonOut(result);
}

// 讓你可以直接用瀏覽器打開網址確認服務有活著
function doGet(e) {
  var p = (e && e.parameter) || {};

  // ?selftest=<SELFTEST_KEY>：以「這個部署實際跑的程式碼」走完寫入 + 寄信，
  // 並回報每一步的結果。用無痕視窗打開，就等同模擬一位匿名訪客。
  if (p.selftest) {
    if (p.selftest !== SELFTEST_KEY) {
      return jsonOut({ ok: false, error: 'selftest key 不正確' });
    }
    var steps = {};
    var row = -1;
    try {
      var t = getSheet();
      t.sheet.appendRow([new Date(), 'SELFTEST', '', '自我測試（可刪除）', '', '', OWNER_EMAIL, '由 selftest 寫入', '待刪除']);
      row = t.sheet.getLastRow();
      steps.sheet = 'ok (row ' + row + ', via ' + t.how + ', 檔名「' + t.ss.getName() + '」)';
    } catch (err) {
      steps.sheet = 'FAILED: ' + err;
    }
    try {
      MailApp.sendEmail({
        to: OWNER_EMAIL,
        subject: '【' + BRAND_NAME + '】selftest 通過（版本 ' + CODE_VERSION + '）',
        htmlBody: '<p>匿名存取路徑正常：已寫入第 ' + row + ' 列並寄出本信。</p>'
      });
      steps.mail = 'ok';
    } catch (err) {
      steps.mail = 'FAILED: ' + err;
    }
    steps.quotaRemaining = mailQuota();
    return jsonOut({ ok: true, selftest: steps, version: CODE_VERSION });
  }

  // ?action=submit：用 GET 送出表單。
  // 有些環境送不出跨網域 POST，但 GET 可以，這條路保證填單不會石沉大海。
  if (p.action === 'submit') {
    return respond(processSubmission(p), p);
  }

  return jsonOut({
    ok: true,
    service: BRAND_NAME + ' form endpoint',
    version: CODE_VERSION,
    features: ['dedupe', 'lock', 'mail']   // 新版才有，舊版不會出現這一行
  });
}

/* ---------- 工具函式 ---------- */

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 取得試算表：優先用 ID，拿不到再退回「目前綁定的試算表」
function getSheet() {
  var ss = null, how = '';
  if (SHEET_ID) {
    try { ss = SpreadsheetApp.openById(SHEET_ID); how = 'openById'; }
    catch (err) { console.error('openById 失敗：' + err); }
  }
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    how = 'active';
  }
  if (!ss) {
    throw new Error('取不到試算表。這支腳本可能是獨立建立的，且 SHEET_ID 未設定或無權限。');
  }
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (!sheet) throw new Error('試算表裡找不到分頁「' + SHEET_NAME + '」');
  return { ss: ss, sheet: sheet, how: how };
}

function mailQuota() {
  try { return MailApp.getRemainingDailyQuota(); } catch (err) { return -1; }
}

/* ---------- 在編輯器裡手動執行這一支，可一次驗證所有權限 ---------- */
/* 用法：上方函式下拉選單選 testSetup → 按「執行」→ 看下方執行紀錄             */
function testSetup() {
  var report = [];

  try {
    var t = getSheet();
    report.push('✅ 試算表：' + t.ss.getName() + ' / 分頁「' + t.sheet.getName() + '」，目前 '
                + t.sheet.getLastRow() + ' 列（取得方式：' + t.how + '）');
    report.push('   綁定式檢查：getActiveSpreadsheet() = '
                + (SpreadsheetApp.getActiveSpreadsheet() ? '有值（綁定式腳本）' : 'null（獨立式腳本）'));
  } catch (err) {
    report.push('❌ 試算表讀取失敗：' + err);
  }

  try {
    report.push('✅ 今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota() + ' 封');
  } catch (err) {
    report.push('❌ 讀不到寄信額度（多半是尚未授權 Gmail 權限）：' + err);
  }

  try {
    MailApp.sendEmail({
      to: OWNER_EMAIL,
      subject: '【' + BRAND_NAME + '】testSetup 測試信（版本 ' + CODE_VERSION + '）',
      htmlBody: '<p>看到這封信，代表寄信功能與權限都正常。</p>'
    });
    report.push('✅ 測試信已寄往 ' + OWNER_EMAIL + '（請到收件匣與垃圾郵件確認）');
  } catch (err) {
    report.push('❌ 寄信失敗：' + err);
  }

  var out = report.join('\n');
  console.log(out);
  return out;
}

/* ---------- 信件版型 ---------- */

function ownerMailHtml(d) {
  const row = function (k, v) {
    return '<tr>' +
      '<td style="padding:8px 12px;background:#f6f7f9;border:1px solid #e3e6ea;width:120px;font-weight:600;color:#333;">' + esc(k) + '</td>' +
      '<td style="padding:8px 12px;border:1px solid #e3e6ea;color:#111;">' + (esc(v) || '—') + '</td>' +
      '</tr>';
  };
  return '' +
    '<div style="font-family:-apple-system,\'Noto Sans TC\',sans-serif;max-width:600px;">' +
      '<h2 style="margin:0 0 4px;color:#111;">收到一筆新的諮詢名單</h2>' +
      '<p style="margin:0 0 16px;color:#666;font-size:13px;">送出時間：' + esc(d.time) + '</p>' +
      '<table style="border-collapse:collapse;width:100%;font-size:14px;">' +
        row('姓名', d.name) + row('職稱', d.title) +
        row('公司名稱', d.company) + row('員工人數', d.size) +
        row('聯絡電話', d.phone) + row('聯絡信箱', d.email) +
        row('需求說明', d.note) +
      '</table>' +
      '<p style="margin:20px 0 0;">' +
        '<a href="' + d.sheetUrl + '" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">開啟名單試算表</a>' +
      '</p>' +
    '</div>';
}

function leadMailHtml(d) {
  return '' +
    '<div style="font-family:-apple-system,\'Noto Sans TC\',sans-serif;max-width:600px;line-height:1.75;color:#222;">' +
      '<p>' + esc(d.name) + ' 您好，</p>' +
      '<p>感謝您對 <strong>' + BRAND_NAME + '</strong> 的關注，我們已收到您的諮詢需求。</p>' +
      '<p>我們的顧問將於 <strong>1 個工作日內</strong>主動與您聯繫，' +
         '為您安排一次<strong>免費的組織心理健康健檢諮詢</strong>。' +
         '諮詢過程不會有任何推銷，也不需要簽約。</p>' +
      '<div style="margin:20px 0;padding:14px 18px;background:#f6f7f9;border-left:3px solid #111;border-radius:4px;font-size:14px;">' +
        '<div style="font-weight:600;margin-bottom:8px;">您這次填寫的內容</div>' +
        '<div>公司名稱：' + esc(d.company) + '</div>' +
        '<div>員工人數：' + (esc(d.size) || '—') + '</div>' +
        '<div>需求說明：' + (esc(d.note) || '—') + '</div>' +
      '</div>' +
      '<p>在優惠期限內送出的表單，已自動為您保留折扣資格，請安心等待我們的聯繫。</p>' +
      '<p style="margin-top:24px;color:#666;font-size:13px;">' +
        BRAND_NAME + '．企業員工心理健康即時預警與介入平台<br>' +
        '（此信為系統自動發送，如需補充說明可直接回覆本信）' +
      '</p>' +
    '</div>';
}
