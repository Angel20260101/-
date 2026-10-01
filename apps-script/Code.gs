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

// 每次改完這份程式碼就把日期往後更新，部署後用瀏覽器打開 /exec 即可確認
// 線上跑的是不是最新版（避免「存檔了但忘記重新部署」的情況）
const CODE_VERSION = '2026-10-01c';

// selftest 用的通行碼。網址帶上 ?selftest=<這組字串> 會實際寫入一列並寄信，
// 用來驗證「匿名訪客」走完整條路徑是否暢通。驗完可以改掉這組字串。
const SELFTEST_KEY = 'aed-check-9471';

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};

    // 蜜罐欄位：機器人才會填，有值就直接當成功回應，不寫入資料
    if (p['bot-field']) return jsonOut({ ok: true });

    const sid     = clean(p.sid,     64);
    const name    = clean(p.name,    100);
    const title   = clean(p.title,   100);
    const company = clean(p.company, 200);
    const size    = clean(p.size,    50);
    const phone   = clean(p.phone,   50);
    const email   = clean(p.email,   200);
    const note    = clean(p.note,    2000);

    // 必填驗證
    if (!name || !company || !phone || !email) {
      return jsonOut({ ok: false, error: '必填欄位未填寫完整' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonOut({ ok: false, error: 'Email 格式不正確' });
    }

    // 去重：同一次送出（含前端連線失敗後的自動重送、使用者連點兩下）只會寫入一筆
    const cache   = CacheService.getScriptCache();
    const sidKey  = sid ? 'sid_' + sid : null;
    if (sidKey && cache.get(sidKey)) return jsonOut({ ok: true, duplicate: true });

    const now = new Date();

    // ---- 1. 寫入試算表（加鎖，避免多人同時送出時互相覆蓋）----
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (err) {
      return jsonOut({ ok: false, error: '系統忙碌中，請稍後再送出一次' });
    }
    try {
      if (sidKey && cache.get(sidKey)) return jsonOut({ ok: true, duplicate: true });

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
      sheet.appendRow([now, name, title, company, size, phone, email, note, '未聯繫']);

      if (sidKey) cache.put(sidKey, '1', 21600);   // 記住 6 小時
      var lastRow = sheet.getLastRow();
      var sheetUrl = ss.getUrl();
    } finally {
      lock.releaseLock();
    }

    // ---- 2. 寄通知信給後台（表單擁有者）----
    // 寄信放在鎖外面，避免寄信變慢時拖住其他人的送出
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

    // ---- 3. 寄自動回覆信給填單者 ----
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

    // 名單已寫入就回 ok，但把寄信結果一併回報，前端 ?debug=1 看得到
    return jsonOut({
      ok: true,
      row: lastRow,
      mailOwner: mailOwner,
      mailLead: mailLead,
      mailError: mailError || undefined,
      quotaRemaining: mailQuota()
    });

  } catch (err) {
    console.error(err);
    return jsonOut({ ok: false, error: '伺服器處理失敗' });
  }
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
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
      sheet.appendRow([new Date(), 'SELFTEST', '', '自我測試（可刪除）', '', '', OWNER_EMAIL, '由 selftest 寫入', '待刪除']);
      row = sheet.getLastRow();
      steps.sheet = 'ok (row ' + row + ')';
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

function mailQuota() {
  try { return MailApp.getRemainingDailyQuota(); } catch (err) { return -1; }
}

/* ---------- 在編輯器裡手動執行這一支，可一次驗證所有權限 ---------- */
/* 用法：上方函式下拉選單選 testSetup → 按「執行」→ 看下方執行紀錄             */
function testSetup() {
  var report = [];

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    report.push('✅ 試算表：' + ss.getName() + ' / 分頁「' + sheet.getName() + '」，目前 ' + sheet.getLastRow() + ' 列');
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
