/*** 心情AED － Google 表單收單通知 ***/
/*
 * 用途：Google 表單有人送出時，自動寄兩封信
 *       1. 通知信給表單擁有者
 *       2. 自動回覆信給填單者
 *
 * 安裝位置：Google 表單「自動產生的回覆試算表」→ 擴充功能 → Apps Script
 *           （不是表單本身，是那張試算表）
 *
 * 安裝步驟：
 *   1. 貼上本檔內容，存檔
 *   2. 函式下拉選單選 createTrigger，按「執行」，完成授權
 *      → 這會建立「表單提交時」的觸發器
 *   3. 選 testNotify 執行一次，確認兩封信都收得到
 *
 * 這支程式不需要「部署」，也沒有網址。觸發器由 Google 伺服器端呼叫，
 * 跟訪客用什麼瀏覽器完全無關。
 */

const OWNER_EMAIL = 'may2003mary@gmail.com';
const BRAND_NAME  = '心情AED';

// 表單題目關鍵字 → 內部欄位。只要題目「包含」關鍵字就會對上，
// 所以題目文字微調（例如加上「（選填）」）不會讓程式失效。
const FIELD_MATCHERS = [
  ['name',    ['姓名']],
  ['title',   ['職稱']],
  ['company', ['公司']],
  ['size',    ['人數', '規模']],
  ['phone',   ['電話']],
  ['email',   ['信箱', '電子郵件', 'Email', 'email']],
  ['note',    ['狀況', '需求']]
];

/* ---------- 一次性安裝：建立觸發器 ---------- */
function createTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 先清掉舊的，避免重複建立導致一次送出寄兩次信
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  const msg = '✅ 觸發器已建立，之後每次有人送出表單都會自動寄信。';
  console.log(msg);
  return msg;
}

/* ---------- 表單送出時自動執行 ---------- */
function onFormSubmit(e) {
  try {
    const data = extractFields(e);

    if (!data.email) {
      console.warn('這筆沒有收到填單者信箱，只寄通知信。namedValues=' + JSON.stringify(e && e.namedValues));
    }

    // 通知信給後台
    try {
      MailApp.sendEmail({
        to: OWNER_EMAIL,
        replyTo: data.email || OWNER_EMAIL,
        subject: '【' + BRAND_NAME + '】新名單：' + (data.company || '未填公司') + ' / ' + (data.name || '未填姓名'),
        htmlBody: ownerMailHtml(data)
      });
    } catch (err) {
      console.error('通知信寄送失敗：' + err);
    }

    // 自動回覆信給填單者
    if (data.email) {
      try {
        MailApp.sendEmail({
          to: data.email,
          subject: '【' + BRAND_NAME + '】已收到您的諮詢需求，我們將於 1 個工作日內與您聯繫',
          htmlBody: leadMailHtml(data)
        });
      } catch (err) {
        console.error('自動回覆信寄送失敗：' + err);
      }
    }
  } catch (err) {
    console.error('onFormSubmit 失敗：' + err);
  }
}

/* ---------- 從觸發器事件取出各欄位 ---------- */
function extractFields(e) {
  const out = { name: '', title: '', company: '', size: '', phone: '', email: '', note: '', time: '' };
  const named = (e && e.namedValues) || {};

  Object.keys(named).forEach(function (question) {
    const answer = [].concat(named[question]).join(' ').trim();
    if (!answer) return;

    // 表單「收集電子郵件地址」產生的欄位
    if (/電子郵件地址|Email Address/i.test(question) && !out.email) {
      out.email = answer;
      return;
    }

    for (var i = 0; i < FIELD_MATCHERS.length; i++) {
      var key = FIELD_MATCHERS[i][0];
      var words = FIELD_MATCHERS[i][1];
      if (out[key]) continue;
      for (var j = 0; j < words.length; j++) {
        if (question.indexOf(words[j]) >= 0) { out[key] = answer; return; }
      }
    }
  });

  out.time = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  try { out.sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch (err) { out.sheetUrl = ''; }
  return out;
}

/* ---------- 安裝後的自我測試 ---------- */
function testNotify() {
  onFormSubmit({
    namedValues: {
      '姓名': ['測試用'],
      '職稱': ['人資主管'],
      '公司名稱': ['測試股份有限公司'],
      '員工人數規模': ['50 – 200 人'],
      '聯絡電話': ['0912345678'],
      '聯絡信箱': [OWNER_EMAIL],
      '目前遇到的狀況或需求': ['這是 testNotify 送出的測試內容']
    }
  });
  const msg = '已送出測試信，請到 ' + OWNER_EMAIL + ' 的收件匣與垃圾郵件確認（應該會收到兩封）。';
  console.log(msg);
  return msg;
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      (d.sheetUrl ? '<p style="margin:20px 0 0;">' +
        '<a href="' + d.sheetUrl + '" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">開啟名單試算表</a>' +
      '</p>' : '') +
    '</div>';
}

function leadMailHtml(d) {
  return '' +
    '<div style="font-family:-apple-system,\'Noto Sans TC\',sans-serif;max-width:600px;line-height:1.75;color:#222;">' +
      '<p>' + (esc(d.name) || '您') + ' 您好，</p>' +
      '<p>感謝您對 <strong>' + BRAND_NAME + '</strong> 的關注，我們已收到您的諮詢需求。</p>' +
      '<p>我們的顧問將於 <strong>1 個工作日內</strong>主動與您聯繫，' +
         '為您安排一次<strong>免費的組織心理健康健檢諮詢</strong>。' +
         '諮詢過程不會有任何推銷，也不需要簽約。</p>' +
      '<div style="margin:20px 0;padding:14px 18px;background:#f6f7f9;border-left:3px solid #111;border-radius:4px;font-size:14px;">' +
        '<div style="font-weight:600;margin-bottom:8px;">您這次填寫的內容</div>' +
        '<div>公司名稱：' + (esc(d.company) || '—') + '</div>' +
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
