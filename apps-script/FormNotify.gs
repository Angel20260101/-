/*** 心情AED － Google 表單：自動建立 + 收單通知 ***/
/*
 * 這一個檔案做兩件事：
 *   setupForm()   一次性安裝。自動建立 Google 表單、接上試算表、裝好寄信觸發器。
 *   onFormSubmit() 每次有人送出表單時，由 Google 伺服器自動呼叫，寄兩封信。
 *
 * ── 怎麼用 ────────────────────────────────────────────────
 * 1. 打開「心情AED-名單後台」試算表 →「擴充功能 → Apps Script」
 * 2. 左側「檔案」旁的 + → 指令碼 → 命名為 FormNotify，把本檔內容整段貼上，存檔
 * 3. 上方函式下拉選單選 setupForm → 按「執行」→ 完成授權
 * 4. 看下方「執行記錄」，裡面會印出表單網址
 *
 * 這支程式不需要「部署」，也沒有網址。觸發器由 Google 伺服器端呼叫，
 * 跟訪客用什麼瀏覽器、什麼手機完全無關。
 */

const OWNER_EMAIL = 'may2003mary@gmail.com';
const BRAND_NAME  = '心情AED';

// 回覆要寫進哪張試算表（網址 /spreadsheets/d/<這一段>/edit）
const SHEET_ID = '1l8Zn4W_KpPIMkzWlgoryzSup9tALcDpslFg7tVu0zgk';

const FORM_TITLE = '心情AED － 索取方案報價 / 預約免費諮詢';
const FORM_DESC  = '留下您的資料，顧問將主動與您聯繫。本表單僅為諮詢與報價需求，不涉及任何付款。';
const FORM_THANKS = '感謝您的填寫！確認信已寄到您的信箱，我們的顧問將於 1 個工作日內與您聯繫。';

// 題目定義。type: text（簡答）/ list（下拉）/ paragraph（段落）
const QUESTIONS = [
  { key: 'name',    title: '姓名',             type: 'text',      required: true  },
  { key: 'title',   title: '職稱',             type: 'text',      required: false, help: '例如：人資主管' },
  { key: 'company', title: '公司名稱',         type: 'text',      required: true  },
  { key: 'size',    title: '員工人數規模',     type: 'list',      required: false,
    choices: ['50 人以下', '50 – 200 人', '200 – 500 人', '500 人以上'] },
  { key: 'phone',   title: '聯絡電話',         type: 'text',      required: true  },
  { key: 'email',   title: '聯絡信箱',         type: 'text',      required: true  },
  { key: 'note',    title: '目前遇到的狀況或需求（選填）', type: 'paragraph', required: false,
    help: '例如：近期離職率偏高、想先了解方案內容…' }
];

// 題目關鍵字 → 內部欄位。用「包含」比對，所以題目文字微調不會讓程式失效。
const FIELD_MATCHERS = [
  ['name',    ['姓名']],
  ['title',   ['職稱']],
  ['company', ['公司']],
  ['size',    ['人數', '規模']],
  ['phone',   ['電話']],
  ['email',   ['信箱', '電子郵件', 'Email', 'email']],
  ['note',    ['狀況', '需求']]
];

/* ======================================================================
   一次性安裝：建立表單 + 接上試算表 + 裝觸發器
   ====================================================================== */
function setupForm() {
  const report = [];

  // 1. 建立表單
  const form = FormApp.create(FORM_TITLE);
  form.setDescription(FORM_DESC);
  form.setConfirmationMessage(FORM_THANKS);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);   // 訪客不需登入 Google
  try { form.setCollectEmail(true); } catch (err) { report.push('⚠️ 收集電子郵件地址設定失敗：' + err); }
  report.push('✅ 已建立表單「' + FORM_TITLE + '」');

  // 2. 加題目
  QUESTIONS.forEach(function (q) {
    var item;
    if (q.type === 'list') {
      item = form.addListItem().setChoiceValues(q.choices);
    } else if (q.type === 'paragraph') {
      item = form.addParagraphTextItem();
    } else {
      item = form.addTextItem();
    }
    item.setTitle(q.title);
    if (q.help) item.setHelpText(q.help);
    item.setRequired(!!q.required);
  });
  report.push('✅ 已加入 ' + QUESTIONS.length + ' 個題目');

  // 3. 回覆寫進指定試算表（會在該檔案新增一個「表單回應」分頁）
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, SHEET_ID);
    report.push('✅ 回覆已接到試算表：' + SpreadsheetApp.openById(SHEET_ID).getName());
  } catch (err) {
    report.push('⚠️ 接試算表失敗（表單仍可用，回覆存在表單內）：' + err);
  }

  // 4. 裝觸發器（先清掉舊的，避免一次送出寄兩封）
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  report.push('✅ 已安裝「表單提交時」觸發器');

  // 5. 印出網址
  var publicUrl = form.getPublishedUrl();
  var shortUrl  = '';
  try { shortUrl = form.shortenFormUrl(publicUrl); } catch (err) {}

  report.push('');
  report.push('──────── 請把下面這串網址貼給 Claude ────────');
  report.push('填寫用網址：' + publicUrl);
  if (shortUrl) report.push('短網址　　：' + shortUrl);
  report.push('編輯用網址：' + form.getEditUrl());
  report.push('─────────────────────────────────────────');

  const out = report.join('\n');
  console.log(out);
  return out;
}

/* ======================================================================
   表單送出時自動執行
   ====================================================================== */
function onFormSubmit(e) {
  try {
    const data = extractFields(e);

    if (!data.email) {
      console.warn('這筆沒有取到填單者信箱，只寄通知信。event=' + JSON.stringify(e && e.namedValues));
    }

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

/* ----------------------------------------------------------------------
   取出欄位。表單觸發器給的是 e.response，試算表觸發器給的是 e.namedValues，
   兩種都支援，之後改綁法也不會壞。
   ---------------------------------------------------------------------- */
function extractFields(e) {
  const out = { name: '', title: '', company: '', size: '', phone: '', email: '', note: '' };
  const pairs = [];

  if (e && e.namedValues) {
    Object.keys(e.namedValues).forEach(function (q) {
      pairs.push([q, [].concat(e.namedValues[q]).join(' ').trim()]);
    });
  } else if (e && e.response && e.response.getItemResponses) {
    e.response.getItemResponses().forEach(function (ir) {
      pairs.push([ir.getItem().getTitle(), [].concat(ir.getResponse()).join(' ').trim()]);
    });
    try {
      var re = e.response.getRespondentEmail();
      if (re) out.email = re;
    } catch (err) {}
  }

  pairs.forEach(function (pair) {
    var question = pair[0], answer = pair[1];
    if (!answer) return;

    if (/電子郵件地址|Email Address/i.test(question)) {
      if (!out.email) out.email = answer;
      return;
    }
    for (var i = 0; i < FIELD_MATCHERS.length; i++) {
      var key = FIELD_MATCHERS[i][0], words = FIELD_MATCHERS[i][1];
      if (out[key]) continue;
      for (var j = 0; j < words.length; j++) {
        if (question.indexOf(words[j]) >= 0) { out[key] = answer; return; }
      }
    }
  });

  out.time = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  try { out.sheetUrl = SpreadsheetApp.openById(SHEET_ID).getUrl(); } catch (err) { out.sheetUrl = ''; }
  return out;
}

/* ---------- 安裝後的自我測試：不用真的填表單也能驗證寄信 ---------- */
function testNotify() {
  onFormSubmit({
    namedValues: {
      '姓名': ['測試用'],
      '職稱': ['人資主管'],
      '公司名稱': ['測試股份有限公司'],
      '員工人數規模': ['50 – 200 人'],
      '聯絡電話': ['0912345678'],
      '聯絡信箱': [OWNER_EMAIL],
      '目前遇到的狀況或需求（選填）': ['這是 testNotify 送出的測試內容']
    }
  });
  const msg = '已送出測試信，請到 ' + OWNER_EMAIL + ' 的收件匣與垃圾郵件確認（應收到兩封）。';
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
