/*** 心情AED － Google 表單：自動建立 + 收單通知 ***/
/*
 * 註：本檔所有全域名稱都加了 FN_ / fn 前綴。
 *     Apps Script 的所有 .gs 檔共用同一個全域範圍，不是各自獨立的模組，
 *     同名的 const 會造成 "Identifier has already been declared" 而整個專案跑不動。
 *     加前綴之後，這個檔案可以和專案裡任何既有檔案並存。
 */
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

const FN_OWNER_EMAIL = 'may2003mary@gmail.com';
const FN_BRAND_NAME  = '心情AED';

// 回覆要寫進哪張試算表（網址 /spreadsheets/d/<這一段>/edit）
const FN_SHEET_ID = '1l8Zn4W_KpPIMkzWlgoryzSup9tALcDpslFg7tVu0zgk';

// 若表單已經建好（例如在別的地方建的），把它的「編輯用網址」貼在這裡，
// 然後執行 attachExistingForm()。網址長這樣（結尾是 /edit，不是 /viewform）：
// https://docs.google.com/forms/d/1AbC.../edit
const FN_FORM_EDIT_URL = 'https://docs.google.com/forms/d/1ABDbJ6d8tn3nll8HI3yCUWEnMOtR6WO5P9BYczXgDLg/edit';

const FN_FORM_TITLE = '心情AED － 索取方案報價 / 預約免費諮詢';
const FN_FORM_DESC  = '留下您的資料，顧問將主動與您聯繫。本表單僅為諮詢與報價需求，不涉及任何付款。';
const FN_FORM_THANKS = '感謝您的填寫！確認信已寄到您的信箱，我們的顧問將於 1 個工作日內與您聯繫。';

// 題目定義。type: text（簡答）/ list（下拉）/ paragraph（段落）
const FN_QUESTIONS = [
  { key: 'name',    title: '姓名',             type: 'text',      required: true  },
  { key: 'title',   title: '職稱',             type: 'text',      required: false, help: '例如：人資主管' },
  { key: 'company', title: '公司名稱',         type: 'text',      required: false },
  { key: 'size',    title: '員工人數規模',     type: 'list',      required: false,
    choices: ['50 人以下', '50 – 200 人', '200 – 500 人', '500 人以上'] },
  { key: 'phone',   title: '聯絡電話',         type: 'text',      required: true  },
  { key: 'email',   title: '聯絡信箱',         type: 'text',      required: true, validate: 'email' },
  { key: 'note',    title: '目前遇到的狀況或需求（選填）', type: 'paragraph', required: false,
    help: '例如：近期離職率偏高、想先了解方案內容…' }
];

// 題目關鍵字 → 內部欄位。用「包含」比對，所以題目文字微調不會讓程式失效。
const FN_FIELD_MATCHERS = [
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
  const form = FormApp.create(FN_FORM_TITLE);
  form.setDescription(FN_FORM_DESC);
  form.setConfirmationMessage(FN_FORM_THANKS);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);   // 訪客不需登入 Google
  try { form.setCollectEmail(true); } catch (err) { report.push('⚠️ 收集電子郵件地址設定失敗：' + err); }
  report.push('✅ 已建立表單「' + FN_FORM_TITLE + '」');

  // 2. 加題目
  FN_QUESTIONS.forEach(function (q) {
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
    if (q.validate === 'email' && item.asTextItem) {
      item.asTextItem().setValidation(
        FormApp.createTextValidation()
          .requireTextIsEmail()
          .setHelpText('請輸入有效的電子郵件地址，例如 you@company.com')
          .build()
      );
    }
  });
  report.push('✅ 已加入 ' + FN_QUESTIONS.length + ' 個題目');

  // 3. 回覆寫進指定試算表（會在該檔案新增一個「表單回應」分頁）
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, FN_SHEET_ID);
    report.push('✅ 回覆已接到試算表：' + SpreadsheetApp.openById(FN_SHEET_ID).getName());
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
   接上「已經建好的」表單：設定回覆去向 + 裝觸發器
   用法：把表單的編輯用網址填進上面的 FN_FORM_EDIT_URL，執行這支函式。
   ====================================================================== */
function attachExistingForm() {
  const report = [];

  if (!FN_FORM_EDIT_URL) {
    const hint = '❌ 請先把表單的「編輯用網址」填進程式最上方的 FN_FORM_EDIT_URL。\n'
               + '   要的是結尾 /edit 的那個，不是 /viewform。';
    console.log(hint);
    return hint;
  }

  let form;
  try {
    form = FormApp.openByUrl(FN_FORM_EDIT_URL);
  } catch (err) {
    const hint = '❌ 打不開這個表單：' + err + '\n'
               + '   請確認 FN_FORM_EDIT_URL 是「編輯用網址」（結尾 /edit），而且是同一個 Google 帳號建立的。';
    console.log(hint);
    return hint;
  }
  report.push('✅ 已開啟表單「' + form.getTitle() + '」');

  // 確認訊息與收集信箱，照落地頁的設定補上（已經設過也不會出錯）
  try { form.setConfirmationMessage(FN_FORM_THANKS); report.push('✅ 已設定確認訊息'); }
  catch (err) { report.push('⚠️ 確認訊息設定失敗：' + err); }
  try { form.setCollectEmail(true); report.push('✅ 已開啟「收集電子郵件地址」'); }
  catch (err) { report.push('⚠️ 收集電子郵件地址設定失敗：' + err); }

  // 回覆寫進指定試算表
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, FN_SHEET_ID);
    report.push('✅ 回覆已接到試算表：' + SpreadsheetApp.openById(FN_SHEET_ID).getName());
  } catch (err) {
    report.push('⚠️ 接試算表失敗（表單仍可用，回覆存在表單內）：' + err);
  }

  // 裝觸發器（先清掉舊的，避免一次送出寄兩封）
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  report.push('✅ 已安裝「表單提交時」觸發器');

  // 列出題目，方便核對關鍵字有沒有對上
  report.push('');
  report.push('目前的題目（確認每一題都有對到欄位）：');
  form.getItems().forEach(function (item) {
    var t = item.getTitle();
    var matched = '（對不到，這題不會進信件內容）';
    for (var i = 0; i < FN_FIELD_MATCHERS.length; i++) {
      for (var j = 0; j < FN_FIELD_MATCHERS[i][1].length; j++) {
        if (t.indexOf(FN_FIELD_MATCHERS[i][1][j]) >= 0) { matched = '→ ' + FN_FIELD_MATCHERS[i][0]; break; }
      }
      if (matched.charAt(0) === '→') break;
    }
    report.push('  ・' + t + '  ' + matched);
  });

  report.push('');
  report.push('──────── 請把下面這串網址貼給 Claude ────────');
  report.push('填寫用網址：' + form.getPublishedUrl());
  report.push('─────────────────────────────────────────');

  const out = report.join('\n');
  console.log(out);
  return out;
}

// 把泛型 Item 轉成具體型別，才能呼叫 setRequired() 等方法
function fnAsTyped(item) {
  var T = FormApp.ItemType;
  switch (item.getType()) {
    case T.TEXT:            return item.asTextItem();
    case T.PARAGRAPH_TEXT:  return item.asParagraphTextItem();
    case T.LIST:            return item.asListItem();
    case T.MULTIPLE_CHOICE: return item.asMultipleChoiceItem();
    case T.CHECKBOX:        return item.asCheckboxItem();
    case T.DROPDOWN:        return item.asListItem();
    case T.SCALE:           return item.asScaleItem();
    case T.DATE:            return item.asDateItem();
    case T.TIME:            return item.asTimeItem();
    default:                return null;   // 圖片、區段標題等沒有必填概念
  }
}

/* ======================================================================
   把 FN_QUESTIONS 的必填與驗證規則，套用到已經建好的表單
   用法：函式下拉選單選 updateFormRules → 執行
   ====================================================================== */
function updateFormRules() {
  const report = [];

  if (!FN_FORM_EDIT_URL) {
    const hint = '❌ 請先把表單的「編輯用網址」填進程式最上方的 FN_FORM_EDIT_URL。';
    console.log(hint);
    return hint;
  }

  let form;
  try {
    form = FormApp.openByUrl(FN_FORM_EDIT_URL);
  } catch (err) {
    const hint = '❌ 打不開表單：' + err + '\n   請確認 FN_FORM_EDIT_URL 是結尾 /edit 的編輯用網址。';
    console.log(hint);
    return hint;
  }
  report.push('✅ 已開啟表單「' + (form.getTitle() || '(未命名)') + '」');

  form.getItems().forEach(function (item) {
    const title = item.getTitle();

    // 用關鍵字找出這一題對應的設定
    var spec = null;
    for (var i = 0; i < FN_QUESTIONS.length; i++) {
      var words = null;
      for (var j = 0; j < FN_FIELD_MATCHERS.length; j++) {
        if (FN_FIELD_MATCHERS[j][0] === FN_QUESTIONS[i].key) { words = FN_FIELD_MATCHERS[j][1]; break; }
      }
      if (!words) continue;
      for (var k = 0; k < words.length; k++) {
        if (title.indexOf(words[k]) >= 0) { spec = FN_QUESTIONS[i]; break; }
      }
      if (spec) break;
    }
    if (!spec) { report.push('・' + title + '　（沒有對應設定，略過）'); return; }

    // form.getItems() 回傳的是泛型 Item，沒有 setRequired()。
    // 必須依題型轉成具體型別才能設定。
    var typed = fnAsTyped(item);
    if (!typed) { report.push('・' + title + '　（這個題型不支援必填設定，略過）'); return; }

    try {
      typed.setRequired(!!spec.required);
    } catch (err) {
      report.push('⚠️ ' + title + ' 設定必填失敗：' + err);
      return;
    }

    var extra = '';
    if (spec.validate === 'email') {
      try {
        item.asTextItem().setValidation(
          FormApp.createTextValidation()
            .requireTextIsEmail()
            .setHelpText('請輸入有效的電子郵件地址，例如 you@company.com')
            .build()
        );
        extra = '，已加上 Email 格式驗證';
      } catch (err) {
        extra = '，⚠️ Email 驗證設定失敗：' + err;
      }
    }
    report.push('・' + title + '　→ ' + (spec.required ? '必填' : '選填') + extra);
  });

  const out = report.join('\n');
  console.log(out);
  return out;
}

/* ======================================================================
   表單送出時自動執行
   ====================================================================== */
function onFormSubmit(e) {
  try {
    const data = fnExtractFields(e);

    if (!data.email) {
      console.warn('這筆沒有取到填單者信箱，只寄通知信。event=' + JSON.stringify(e && e.namedValues));
    }

    try {
      MailApp.sendEmail({
        to: FN_OWNER_EMAIL,
        replyTo: data.email || FN_OWNER_EMAIL,
        subject: '【' + FN_BRAND_NAME + '】新名單：' + (data.company || '未填公司') + ' / ' + (data.name || '未填姓名'),
        htmlBody: fnOwnerMailHtml(data)
      });
    } catch (err) {
      console.error('通知信寄送失敗：' + err);
    }

    if (data.email) {
      try {
        MailApp.sendEmail({
          to: data.email,
          subject: '【' + FN_BRAND_NAME + '】已收到您的諮詢需求，我們將於 1 個工作日內與您聯繫',
          htmlBody: fnLeadMailHtml(data)
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
function fnExtractFields(e) {
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
    for (var i = 0; i < FN_FIELD_MATCHERS.length; i++) {
      var key = FN_FIELD_MATCHERS[i][0], words = FN_FIELD_MATCHERS[i][1];
      if (out[key]) continue;
      for (var j = 0; j < words.length; j++) {
        if (question.indexOf(words[j]) >= 0) { out[key] = answer; return; }
      }
    }
  });

  out.time = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  try { out.sheetUrl = SpreadsheetApp.openById(FN_SHEET_ID).getUrl(); } catch (err) { out.sheetUrl = ''; }
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
      '聯絡信箱': [FN_OWNER_EMAIL],
      '目前遇到的狀況或需求（選填）': ['這是 testNotify 送出的測試內容']
    }
  });
  const msg = '已送出測試信，請到 ' + FN_OWNER_EMAIL + ' 的收件匣與垃圾郵件確認（應收到兩封）。';
  console.log(msg);
  return msg;
}

/* ---------- 工具 ---------- */
// 信件樣板專用：跳脫 HTML，空值顯示破折號，避免信裡出現空白格
function fnVal(x) {
  var t = String(x == null ? '' : x).trim();
  return t ? fnEsc(t) : '—';
}

function fnEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- 信件版型 ---------- */
function fnOwnerMailHtml(d) {
  const row = function (label, value) {
    return '<tr>' +
      '<td style="padding:0 0 16px;width:38%;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">' + fnEsc(label) + '</td>' +
      '<td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(value) + '</td>' +
      '</tr>';
  };
  return '' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5EFE1;padding:32px 0;font-family:\'Noto Sans TC\',\'Microsoft JhengHei\',Arial,sans-serif;">' +
    '  <tr><td align="center">' +
    '    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFEFB;border-radius:18px;overflow:hidden;border:1px solid #E6DDCB;">' +
    '      <tr>' +
    '        <td style="background-color:#3E4A32;padding:32px 40px;text-align:center;">' +
    '          <p style="margin:0 0 6px;color:#A6D695;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;">NEW LEAD</p>' +
    '          <h1 style="margin:0;color:#FFFEFB;font-size:22px;font-weight:900;">收到一筆新的諮詢名單</h1>' +
    '          <p style="margin:8px 0 0;color:#E2EAB6;font-size:13px;">' + fnEsc(d.time) + '</p>' +
    '        </td>' +
    '      </tr>' +
    '      <tr>' +
    '        <td style="padding:32px 40px 0;">' +
    '          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5EFE1;border-radius:14px;">' +
    '            <tr><td style="padding:26px 28px;">' +
    '              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
                     row('姓名', d.name) +
                     row('職稱', d.title) +
                     row('公司名稱', d.company) +
                     row('員工人數規模', d.size) +
                     row('聯絡電話', d.phone) +
                     row('聯絡信箱', d.email) +
    '                <tr>' +
    '                  <td style="padding:0;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">遇到的狀況／需求</td>' +
    '                  <td style="padding:0;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.note) + '</td>' +
    '                </tr>' +
    '              </table>' +
    '            </td></tr>' +
    '          </table>' +
    '        </td>' +
    '      </tr>' +
    (d.sheetUrl ?
    '      <tr><td style="padding:24px 40px 0;text-align:center;">' +
    '        <a href="' + d.sheetUrl + '" style="display:inline-block;padding:13px 28px;background-color:#C97B5B;color:#FFFEFB;text-decoration:none;border-radius:999px;font-size:15px;font-weight:800;">開啟名單試算表</a>' +
    '      </td></tr>' : '') +
    '      <tr><td style="padding:24px 40px 32px;">' +
    '        <p style="margin:0;color:#79705D;font-size:13px;line-height:1.7;">直接回覆這封信即可聯繫填單者（回覆地址已設為對方信箱）。</p>' +
    '      </td></tr>' +
    '      <tr>' +
    '        <td style="background-color:#2A3320;padding:20px 40px;text-align:center;">' +
    '          <p style="margin:0;color:#E2EAB6;font-size:13px;font-weight:700;">心情AED｜Mood AED</p>' +
    '        </td>' +
    '      </tr>' +
    '    </table>' +
    '  </td></tr>' +
    '</table>';
}

function fnLeadMailHtml(d) {
  return '' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5EFE1;padding:32px 0;">' +
    '  <tr>' +
    '    <td align="center">' +
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#FFFEFB;border-radius:18px;overflow:hidden;border:1px solid #E6DDCB;">' +
    '' +
    '        <!-- 品牌頭 -->' +
    '        <tr>' +
    '          <td style="background-color:#3E4A32;padding:40px 40px 32px;text-align:center;">' +
    '            <p style="margin:0 0 6px;color:#A6D695;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;">MOOD AED</p>' +
    '            <h1 style="margin:0 0 10px;color:#FFFEFB;font-size:26px;font-weight:900;letter-spacing:.02em;">心情AED</h1>' +
    '            <p style="margin:0;color:#E2EAB6;font-size:14px;">企業員工心理健康即時預警與介入平台</p>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '        <!-- 內文 -->' +
    '        <tr>' +
    '          <td style="padding:36px 40px 8px;">' +
    '            <h2 style="margin:0 0 18px;color:#3A3428;font-size:20px;font-weight:800;">您的諮詢申請已收到</h2>' +
    '            <p style="margin:0 0 8px;color:#3A3428;font-size:16px;line-height:1.8;">' + fnVal(d.name) + ' 您好，</p>' +
    '            <p style="margin:0 0 24px;color:#79705D;font-size:15px;line-height:1.9;">' +
    '              謝謝您填寫「索取方案報價／預約免費諮詢」表單，我們已收到您的資料，以下為本次申請內容。顧問將於 <strong style="color:#C97B5B;">1 個工作日內</strong> 主動與您聯繫，說明最適合貴公司規模的方案。' +
    '            </p>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '        <!-- 資料卡片 -->' +
    '        <tr>' +
    '          <td style="padding:0 40px;">' +
    '            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5EFE1;border-radius:14px;">' +
    '              <tr>' +
    '                <td style="padding:26px 28px;">' +
    '                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;width:38%;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">姓名</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.name) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">職稱</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.title) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">公司名稱</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.company) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">員工人數規模</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.size) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">聯絡電話</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.phone) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0 0 16px;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">聯絡信箱</td>' +
    '                      <td style="padding:0 0 16px;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.email) + '</td>' +
    '                    </tr>' +
    '                    <tr>' +
    '                      <td style="padding:0;color:#79705D;font-size:13px;font-weight:700;vertical-align:top;">遇到的狀況／需求</td>' +
    '                      <td style="padding:0;color:#3A3428;font-size:15px;vertical-align:top;">' + fnVal(d.note) + '</td>' +
    '                    </tr>' +
    '                  </table>' +
    '                </td>' +
    '              </tr>' +
    '            </table>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '        <!-- 狀態提示 -->' +
    '        <tr>' +
    '          <td style="padding:24px 40px 0;">' +
    '            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid #C97B5B;background-color:#FBF3EC;border-radius:0 10px 10px 0;">' +
    '              <tr>' +
    '                <td style="padding:16px 20px;">' +
    '                  <p style="margin:0 0 4px;color:#A85F42;font-size:14px;font-weight:800;">目前狀態：已收件，待顧問聯繫</p>' +
    '                  <p style="margin:0;color:#79705D;font-size:13px;line-height:1.7;">本表單僅為諮詢與報價需求，不涉及任何付款。若 1 個工作日內未收到我們的聯繫，歡迎直接回覆這封信與我們聯繫。</p>' +
    '                </td>' +
    '              </tr>' +
    '            </table>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '        <!-- 結語 -->' +
    '        <tr>' +
    '          <td style="padding:28px 40px 40px;">' +
    '            <p style="margin:0;color:#3A3428;font-size:15px;line-height:1.9;">' +
    '              期待成為貴公司員工身邊，那一份「被接住」的安全感。' +
    '            </p>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '        <!-- Footer -->' +
    '        <tr>' +
    '          <td style="background-color:#2A3320;padding:24px 40px;text-align:center;">' +
    '            <p style="margin:0;color:#E2EAB6;font-size:13px;font-weight:700;">心情AED｜Mood AED</p>' +
    '            <p style="margin:6px 0 0;color:#9AA688;font-size:12px;">企業員工心理健康即時預警與介入平台</p>' +
    '          </td>' +
    '        </tr>' +
    '' +
    '      </table>' +
    '    </td>' +
    '  </tr>' +
    '</table>';
}
