/**
 * 各種面板：信任說明、島嶼、天氣打卡、心情溫度計、燈塔、時光郵局、
 * 碼頭許願、我的紀錄、航海圖、收藏、關於。
 * 共用同一個抽屜樣式；手機上是底部抽屜，桌機上是置中卡片。
 */
import { scanForRisk } from '../core/safety.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class Sheet {
  constructor(mount) {
    this.mount = mount;
    this.mount.addEventListener('click', (e) => {
      if (e.target === this.mount && this.dismissable !== false) this.close();
    });
  }

  open({ title, subtitle, body, actions = [], dismissable = true, mini = false }) {
    clearTimeout(this._timer);
    this.dismissable = dismissable;
    this.mount.hidden = false;
    this.mount.replaceChildren();
    const sheet = document.createElement('div');
    sheet.className = `sheet${mini ? ' sheet--mini' : ''}`;
    sheet.innerHTML = `
      <div class="sheet__head">
        <div>
          <h2 class="sheet__title">${esc(title)}</h2>
          ${subtitle ? `<p class="sheet__sub">${esc(subtitle)}</p>` : ''}
        </div>
        ${dismissable ? '<button type="button" class="sheet__close" aria-label="關閉">×</button>' : ''}
      </div>
      <div class="sheet__body"></div>
      <div class="sheet__foot"></div>`;
    sheet.querySelector('.sheet__body').innerHTML = body;
    const foot = sheet.querySelector('.sheet__foot');
    if (!actions.length) foot.remove();
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = a.className ?? 'btn';
      btn.textContent = a.label;
      btn.addEventListener('click', () => a.onClick(sheet));
      foot.appendChild(btn);
    }
    sheet.querySelector('.sheet__close')?.addEventListener('click', () => this.close());
    this.mount.appendChild(sheet);
    this.el = sheet;
    return sheet;
  }

  /** 讓「做完就走」的流程自己收掉，不用使用者再按一次。 */
  autoClose(ms, after) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.close(); after?.(); }, ms);
  }

  close() {
    clearTimeout(this._timer);
    this.mount.hidden = true;
    this.mount.replaceChildren();
    this.onClose?.();
  }
}

/* ────────────────────────────────────────────────────────
   第一次進站：三行信任說明
   研究計畫要觀察的是「受測者能不能說出 HR 看得到什麼」，
   所以這三行講的就是這件事，而且只在第一次出現。
   ──────────────────────────────────────────────────────── */
export function trustPanel(sheet, { onDone }) {
  sheet.open({
    title: '進來之前，先講三件事',
    subtitle: '看完就不會再出現',
    dismissable: false,
    body: `
      <div class="trust">
        <div class="trust__row">
          <span class="trust__dot">1</span>
          <span class="trust__text">不用註冊，也<b>不用填任何個人資料</b>。關掉就關掉，沒有紀錄留在公司那邊。</span>
        </div>
        <div class="trust__row">
          <span class="trust__dot">2</span>
          <span class="trust__text">你在島上選的、寫的、記的，<b>公司一律看不到</b>。沒有分數，也沒有人會被約談。</span>
        </div>
        <div class="trust__row">
          <span class="trust__dot">3</span>
          <span class="trust__text">公司只會看到<b>「有多少人提了哪些主題」</b>——看不到是誰說的，也看不到原文。</span>
        </div>
      </div>
      <p class="tiny">這座島不做心理診斷，也不評價你的選擇。隨時可以離開。</p>`,
    actions: [{ label: '我知道了，進去看看', onClick: () => { sheet.close(); onDone?.(); } }],
  });
}

/* ──────────────── 每日：天氣打卡（一鍵） ──────────────── */
export function dailyPanel(sheet, { content, state, onPick, onWeekly }) {
  const cfg = content.dailyWeekly.daily;
  const today = state.todayCheckin();
  const ICON = { sun: '☀️', cloud: '☁️', rain: '🌧️' };

  const buttons = cfg.options.map((o) => `
    <button type="button" class="weather__btn${today?.mood_id === o.mood_id ? ' is-on' : ''}" data-mood="${o.mood_id}">
      <span class="weather__icon" aria-hidden="true">${ICON[o.icon] ?? '·'}</span>
      <span class="weather__label">${esc(o.label)}</span>
      <span class="weather__desc">${esc(o.description)}</span>
    </button>`).join('');

  const pendingWeekly = !state.thisWeekEntry();
  const el = sheet.open({
    title: cfg.title,
    subtitle: `${cfg.prompt}${cfg.sub_prompt}`,
    mini: true,
    body: `<div class="weather">${buttons}</div>
           ${today ? '<p class="tiny" style="margin-top:14px;text-align:center">今天記過了，再點一次可以改。</p>' : ''}
           ${pendingWeekly ? '<p style="text-align:center;margin-top:16px"><button type="button" class="btn btn--quiet" id="go-weekly">這週的心情溫度計還沒做　›</button></p>' : ''}`,
  });
  el.querySelector('#go-weekly')?.addEventListener('click', () => onWeekly?.());

  el.querySelectorAll('[data-mood]').forEach((btn) => btn.addEventListener('click', () => {
    const moodId = btn.dataset.mood;
    const option = cfg.options.find((o) => o.mood_id === moodId);
    state.saveCheckin({ moodId });
    onPick?.(moodId);                       // 島上的天氣立刻變

    // 打卡是每天都要做的事，所以做完就讓它自己收掉——不追問、不加步驟
    sheet.open({
      title: '記下來了',
      mini: true,
      body: `
        <div class="weather__after">
          <span class="weather__icon" aria-hidden="true">${ICON[option.icon]}</span>
          <b>${esc(option.island_line)}</b>
          <span class="muted">${esc(cfg.closing_lines[moodId] ?? '')}</span>
        </div>`,
    });
    sheet.autoClose(1700);
  }));
}

/* ──────────────── 每週：心情溫度計（BSRS-5） ──────────────── */
export function weeklyPanel(sheet, { content, state, onSafety, onSaved }) {
  const cfg = content.dailyWeekly.weekly;
  const inst = cfg.instrument;
  const safety = cfg.safety_item;
  const done = state.thisWeekEntry();

  const scaleRow = (itemId, options) => `<div class="scale">${options.map((s) =>
    `<button type="button" class="scale__btn" data-item="${itemId}" data-value="${s.value}">${s.value}<br>${esc(s.label)}</button>`).join('')}</div>`;

  const items = inst.items.map((it, i) => `
    <div class="q"><div class="q__text">${i + 1}. ${esc(it.text)}</div>${scaleRow(it.item_id, inst.scale)}</div>`).join('');

  const el = sheet.open({
    title: cfg.title,
    subtitle: `${cfg.subtitle}　・　${inst.recall_period}`,
    body: `
      <p class="muted">${esc(inst.stem)}</p>
      ${done ? '<p class="tiny">這週做過了，再做一次會蓋掉原本的紀錄。</p>' : ''}
      ${items}
      <div class="q q--star"><div class="q__text">${esc(safety.text)}</div>${scaleRow(safety.item_id, safety.options)}</div>
      <p class="tiny">${esc(safety.note)}</p>
      <p class="tiny">${esc(inst.origin)}</p>
      <div id="weekly-safety"></div>`,
    actions: [{ label: '完成', onClick: submit }],
  });

  const answers = {};
  let safetyValue = null;
  const btn = el.querySelector('.sheet__foot .btn');
  const sync = () => { btn.disabled = Object.keys(answers).length < inst.items.length || safetyValue === null; };
  sync();

  el.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => {
    const item = b.dataset.item;
    const value = Number(b.dataset.value);
    el.querySelectorAll(`[data-item="${item}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
    if (item === safety.item_id) {
      safetyValue = value;
      el.querySelector('#weekly-safety').innerHTML =
        value >= safety.trigger_threshold
          ? '<p class="tiny" style="color:#c2604a">完成後會直接帶你到燈塔，那裡有可以馬上打的電話。</p>' : '';
    } else {
      answers[item] = value;
    }
    sync();
  }));

  function submit() {
    const score = inst.items.reduce((s, i) => s + answers[i.item_id], 0);
    const band = inst.bands.find((b) => score >= b.min && score <= b.max);
    const { keepsake } = state.saveThermometer({ answers, score, bandId: band.band_id, safetyValue });
    const flagged = safetyValue >= safety.trigger_threshold;

    // 依官方說明：結果只呈現顏色與一段說明，不給玩家看分數
    sheet.open({
      title: '這一週記錄下來了',
      body: `
        <div class="card">
          <div class="band">
            <span class="band__dot" style="background:${band.color}"></span>
            <span class="band__label">${esc(band.label)}</span>
          </div>
          <p class="card__text">${esc(band.copy)}</p>
          <p class="card__note">${esc(inst.disclaimer)}</p>
        </div>
        <div class="card">
          <div class="card__kicker">紀念物</div>
          <h3 class="card__title">${esc(keepsake.name)}</h3>
          <p class="card__text">${esc(keepsake.description)}</p>
          <p class="tiny">${esc(cfg.reward.rule)}</p>
        </div>`,
      actions: flagged
        ? [{ label: '去看看燈塔', className: 'btn btn--accent', onClick: () => onSafety?.() }]
        : [{ label: '回到島上', onClick: () => { sheet.close(); onSaved?.(); } }],
    });
    if (!flagged) onSaved?.();
  }
}

/* ──────────────── 燈塔：求助資源 ──────────────── */
export function lighthousePanel(sheet, { content }) {
  const s = content.dailyWeekly.safety;
  const rows = s.resources.map((r) => `
    <div class="atlas__row">
      <div class="atlas__main">
        <div class="atlas__name">${esc(r.name)}</div>
        <div class="atlas__story">${esc(r.hours)}${r.note ? '　・　' + esc(r.note) : ''}</div>
      </div>
      <a class="hud__btn" href="tel:${esc(r.contact)}">${esc(r.contact)}</a>
    </div>`).join('');
  sheet.open({
    title: '燈塔',
    subtitle: '隨時可以點，不必說原因',
    body: `
      <p class="muted">燈亮著不代表你一定要走過去。但它會一直亮著。</p>
      ${rows}
      <p class="card__note" style="margin-top:14px">${esc(s.closing)}</p>
      <p class="tiny">點電話號碼可以直接撥出。這些資源與你在島上的任何紀錄無關，也不會留下你來過的痕跡。</p>`,
  });
}

/* ──────────────── 時光郵局（E5） ──────────────── */
export function letterPanel(sheet, { state, content }) {
  const letters = state.letters();
  const ready = letters.filter((l) => l.ready && !l.opened);
  const waiting = letters.filter((l) => !l.ready);

  const list = letters.length ? `
    <div class="section-label">郵局裡的信</div>
    ${letters.map((l) => `
      <div class="atlas__row">
        <div class="atlas__main">
          <div class="atlas__name">${l.ready ? (l.opened ? '已開封' : '可以開了') : '還在路上'}</div>
          <div class="atlas__story">${new Date(l.written_at).toLocaleDateString('zh-TW')} 寄出　・　${new Date(l.open_at).toLocaleDateString('zh-TW')} 開封</div>
        </div>
        ${l.ready ? `<button type="button" class="hud__btn" data-open="${l.letter_id}">${l.opened ? '再看' : '開封'}</button>` : ''}
      </div>`).join('')}` : '';

  const el = sheet.open({
    title: '時光郵局',
    subtitle: `寫給未來的自己　・　只有你看得到${ready.length ? `　・　有 ${ready.length} 封可以開了` : ''}`,
    body: `
      <textarea class="field" id="letter-text" rows="5" maxlength="800" placeholder="想跟未來的自己說什麼？"></textarea>
      <div class="section-label">多久之後開封</div>
      <div class="scale">
        <button type="button" class="scale__btn is-on" data-days="7">7 天</button>
        <button type="button" class="scale__btn" data-days="30">1 個月</button>
        <button type="button" class="scale__btn" data-days="90">3 個月</button>
      </div>
      <p class="tiny" style="margin-top:10px">信只存在這台裝置，不會上傳，公司看不到。
        <button type="button" class="btn btn--quiet" id="letter-help" style="padding:2px 6px;font-size:12px">不知道怎麼寫？幫我起個頭</button>
      </p>
      ${list}
      <div id="letter-read"></div>`,
    actions: [{ label: '寄出', onClick: send }],
  });

  let days = 7;
  const textEl = el.querySelector('#letter-text');
  el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    el.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('is-on', x === b));
  }));

  // 「幫我起個頭」：用你最近的天氣與走過的島組一句開頭，在本機組，不送出任何東西
  el.querySelector('#letter-help').addEventListener('click', () => {
    const recent = state.recentCheckins(7).filter((d) => d.entry);
    const rainy = recent.filter((d) => d.entry.mood_id === 'rainy').length;
    const cards = state.collection().cards;
    const bits = [];
    bits.push(rainy >= 3 ? '這一週有好幾天是雨天。' : recent.length ? '這一週的天氣大致還行。' : '今天是我第一次來這座島。');
    if (cards.length) bits.push(`我在島上拿到的那張「${cards[cards.length - 1].title}」，我想記得它。`);
    bits.push('寫這封信的時候，我想跟之後的自己說——');
    textEl.value = bits.join('\n');
    textEl.focus();
  });

  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const l = state.openLetter(b.dataset.open);
    el.querySelector('#letter-read').innerHTML = `
      <div class="card" style="margin-top:14px">
        <div class="card__kicker">${new Date(l.written_at).toLocaleDateString('zh-TW')} 的你寫的</div>
        <p class="card__text">${esc(l.text)}</p>
      </div>`;
  }));

  function send() {
    const text = textEl.value.trim();
    if (!text) { textEl.focus(); return; }
    state.saveLetter({ text, openInDays: days });
    sheet.open({
      title: '寄出去了',
      mini: true,
      body: `<p class="card__text">信會在 ${days} 天後回到郵局。在那之前，連你自己都看不到內容。</p>
             <p class="tiny">它只存在這台裝置。換手機或清除瀏覽器資料就會不見。</p>`,
      actions: [{ label: '好', onClick: () => sheet.close() }],
    });
  }
}

/* ──────────────── 碼頭許願（E6） ──────────────── */
export function wishPanel(sheet, { state, content, onSent }) {
  const THEMES = ['下班後不傳訊息', '主管溝通方式', '工作量與人力', '薪資福利', '休息空間', '其他'];
  const sent = state.wishes().length;

  const el = sheet.open({
    title: '碼頭許願',
    subtitle: '寫下希望工作環境改變什麼',
    body: `
      <div class="card">
        <p class="card__text">你寫的原文<b>不會</b>進到公司。小船只載走一個主題，公司看到的是「有幾個人提了這件事」。</p>
        <p class="tiny">沒有代碼、沒有部門、沒有名字。達到一定人數才會顯示，所以不會因為只有你一個人提而被認出來。</p>
      </div>
      <div class="section-label">想改變的是哪一塊</div>
      <div class="weather" style="grid-template-columns:repeat(2,1fr);gap:8px">
        ${THEMES.map((t, i) => `<button type="button" class="scale__btn" data-theme="${i}">${esc(t)}</button>`).join('')}
      </div>
      <div class="section-label">想說的話（只有你看得到）</div>
      <textarea class="field" id="wish-text" rows="4" maxlength="300" placeholder="可以不寫，只選上面的主題也算數。"></textarea>
      <div id="wish-safety"></div>
      ${sent ? `<p class="tiny" style="margin-top:12px">你已經放出 ${sent} 艘小船。</p>` : ''}`,
    actions: [{ label: '放小船出發', onClick: send }],
  });

  let theme = null;
  const textEl = el.querySelector('#wish-text');
  const btn = el.querySelector('.sheet__foot .btn');
  btn.disabled = true;
  el.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    theme = THEMES[Number(b.dataset.theme)];
    el.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('is-on', x === b));
    btn.disabled = false;
  }));
  textEl.addEventListener('input', () => {
    const risk = scanForRisk(textEl.value, content.dailyWeekly.safety);
    el.querySelector('#wish-safety').innerHTML = risk.flagged
      ? '<p class="tiny" style="color:#c2604a;margin-top:8px">看起來這陣子不好過。燈塔那邊有可以馬上打的電話。</p>' : '';
  });

  function send() {
    state.saveWish({ text: textEl.value.trim(), theme });
    sheet.open({
      title: '小船出發了',
      mini: true,
      body: `<p class="card__text">它會停在願望島。公司確認可以做到之後，那裡會長出一棵樹。</p>
             <p class="tiny">船上只有「${esc(theme)}」這四到七個字。你寫的那段話留在這台裝置，沒有跟著走。</p>`,
      actions: [{ label: '好', onClick: () => { sheet.close(); onSent?.(); } }],
    });
  }
}

/* ──────────────── 願望島看板 ──────────────── */
/**
 * 點願望島會看到這裡。
 *
 * 島上的每一艘船都是玩家自己放出去的，每一棵樹都對應公司實際回應過的主題。
 * 這個面板要回答的是同一件事：「我寫的那些，到底有沒有去到哪裡。」
 * 公司的回應來自 content/wish_board.json，前端只負責呈現，不會自己生成答案。
 */
export function wishBoardPanel(sheet, { state, content, onWish }) {
  const board = content.wishBoard;
  const statuses = new Map(board.statuses.map((s) => [s.status_id, s]));
  const mine = state.wishes();
  const mineBy = new Map();
  for (const w of mine) mineBy.set(w.theme, (mineBy.get(w.theme) ?? 0) + 1);

  const ORDER = { done: 0, in_progress: 1, received: 2 };
  const DOT = { done: 'var(--accent)', in_progress: 'var(--gold)', received: 'var(--line)' };
  const rows = [...board.themes]
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))
    .map((t) => {
      const st = statuses.get(t.status);
      const mineCount = mineBy.get(t.theme) ?? 0;
      return `
        <div class="band" style="align-items:flex-start">
          <span class="band__dot" style="background:${DOT[t.status] ?? 'var(--line)'};margin-top:7px"></span>
          <span>
            <b>${esc(t.theme)}</b>
            <span class="muted">　${esc(st?.label ?? '')}</span>
            ${mineCount ? `<span class="tiny">　・　你放了 ${mineCount} 艘</span>` : ''}
            ${t.response ? `<p class="card__text" style="margin:4px 0 0">${esc(t.response)}</p>` : ''}
            ${t.updated_at ? `<p class="tiny" style="margin:2px 0 0">${esc(t.updated_at)} 更新</p>` : ''}
          </span>
        </div>`;
    }).join('');

  const trees = board.themes.filter((t) => statuses.get(t.status)?.growth === 'tree').length;
  const saplings = board.themes.filter((t) => statuses.get(t.status)?.growth === 'sapling').length;

  sheet.open({
    title: '願望島',
    subtitle: mine.length ? `你放出去的 ${mine.length} 艘小船都停在這裡` : '還沒有船停在這裡',
    body: `
      <div class="card">
        <p class="card__text">島上現在有 ${trees} 棵樹、${saplings} 株樹苗。每一棵都對應公司真的回覆過的一件事。</p>
        <p class="tiny">你寫的那段話留在你自己的裝置上，沒有上傳。公司收到的只有主題，而且要滿 ${board.k_anonymity_min} 個人提過同一件事才會出現在他們的報表上。</p>
      </div>
      <div class="section-label">公司怎麼回的</div>
      ${rows}
      <p class="tiny">沒有回應的主題就空在那裡，島上不會長東西。這裡不會替公司講好話。</p>`,
    actions: [
      { label: '再放一艘小船', onClick: () => onWish?.() },
      { label: '關起來', className: 'btn btn--ghost', onClick: () => sheet.close() },
    ],
  });
}

/* ──────────────── 我的紀錄（E9） ──────────────── */
export function recordsPanel(sheet, { state, content, onAtlas, onCollection, onBackup }) {
  const COLOR = { sunny: '#f3d08c', cloudy: '#b9c4c2', rainy: '#8fadb4' };
  const days = state.recentCheckins(28);
  const cells = days.map(({ date, entry }) =>
    `<div class="cal__cell" title="${date}" style="${entry ? `background:${COLOR[entry.mood_id]}` : ''}"></div>`).join('');

  const bands = content.dailyWeekly.weekly.instrument.bands;
  const weekly = state.data.weekly.slice(-6);
  const weekRows = weekly.length ? weekly.map((w) => {
    const b = bands.find((x) => x.band_id === w.band_id);
    return `<div class="band"><span class="band__dot" style="background:${b?.color ?? '#ccc'}"></span>
      <span><b>${esc(w.week)}</b>　<span class="muted">${esc(b?.label ?? '')}</span></span></div>`;
  }).join('') : '<p class="muted">還沒有紀錄。每週一次，自願。</p>';

  const counted = days.filter((d) => d.entry).length;
  const wishes = state.wishes().length;
  const letters = state.letters().length;

  sheet.open({
    title: '我的紀錄',
    subtitle: '只有你看得到',
    body: `
      <div class="section-label">最近四週的天氣</div>
      <div class="cal">${cells}</div>
      <div class="cal__legend">
        <span><i class="cal__key" style="background:${COLOR.sunny}"></i>晴</span>
        <span><i class="cal__key" style="background:${COLOR.cloudy}"></i>陰</span>
        <span><i class="cal__key" style="background:${COLOR.rainy}"></i>雨</span>
        <span><i class="cal__key" style="background:var(--line)"></i>沒來</span>
      </div>
      <p class="tiny">28 天裡來了 ${counted} 天。沒來的日子不代表什麼，島上也沒有任何東西因此消失。</p>
      <div class="section-label">每週心情溫度計</div>
      ${weekRows}
      <p class="tiny">只顯示顏色，不顯示分數。</p>
      <div class="section-label">其他</div>
      <p class="muted">放出去的小船 ${wishes} 艘　・　郵局裡的信 ${letters} 封</p>
      <div class="section-label">換手機也要留著</div>
      <p class="tiny">以上這些只存在這台裝置的瀏覽器裡。清快取或換手機就會不見。</p>`,
    actions: [
      { label: '保存紀錄', className: 'btn btn--ghost', onClick: () => onBackup?.() },
      { label: '航海圖', className: 'btn btn--ghost', onClick: () => onAtlas?.() },
      { label: '收藏', className: 'btn btn--ghost', onClick: () => onCollection?.() },
    ],
  });
}

/* ──────────────── 島嶼 ──────────────── */
export function islandPanel(sheet, { island, state, content, onPlay }) {
  const st = state.islandState(island.island_id);
  const meta = content.islandById(island.island_id);
  if (!meta) return;
  const story = content.storyIndex.find((s) => s.story_id === meta.story_id);
  const routes = meta.growth.map((g) => {
    const found = (st.routes ?? []).includes(g.route_id);
    return `<li>${found ? `<b>${esc(g.label)}</b>　<span class="tiny">已長出</span>`
      : '<span class="muted">？？？　還沒走到的航線</span>'}</li>`;
  }).join('');

  if (!st.unlocked) {
    sheet.open({
      title: '還沒探索的島',
      subtitle: `第 ${meta.order} 座`,
      body: `
        <div class="card">
          <div class="card__kicker">${esc(story.theme)}</div>
          <h3 class="card__title">《${esc(story.title)}》</h3>
          <p class="card__text">${esc(story.logline)}</p>
          <p class="card__note">約 ${story.estimated_minutes} 分鐘　・　${story.endings} 個結局　・　3 條航線</p>
          ${story.content_notes?.length ? `<p class="tiny">內容提醒：${story.content_notes.map(esc).join('、')}</p>` : ''}
        </div>
        <p class="muted">走完一次就會解鎖這座島，然後你可以替它取名字。中途離開也沒關係，進度會留著。</p>`,
      actions: [{ label: '出航', onClick: () => onPlay(meta.story_id) }],
    });
    return;
  }

  sheet.open({
    title: st.name || meta.default_name,
    subtitle: `《${story.title}》　・　走過 ${st.plays} 次　・　航線 ${st.routes.length}／${meta.growth.length}`,
    body: `
      <div class="card">
        <div class="card__kicker">${esc(story.theme)}</div>
        <p class="card__text">${esc(story.logline)}</p>
      </div>
      <div class="section-label">島上的地景</div>
      <ul>${routes}</ul>
      <p class="tiny">重走已經發現的航線不會重複長出地景，也沒有任何懲罰。島嶼只會長大，不會因為你沒來而退化。</p>`,
    actions: [
      { label: '再走一次', onClick: () => onPlay(meta.story_id) },
      { label: '改名字', className: 'btn btn--ghost',
        onClick: () => renamePanel(sheet, { state, meta, onDone: () => islandPanel(sheet, { island, state, content, onPlay }) }) },
    ],
  });
}

function renamePanel(sheet, { state, meta, onDone }) {
  const current = state.islandState(meta.island_id).name || meta.default_name;
  sheet.open({
    title: '替這座島取名字',
    subtitle: meta.name_hint,
    mini: true,
    body: `<input class="field" id="rename" maxlength="12" value="${esc(current)}" />
           <p class="tiny" style="margin-top:10px">最多 12 個字，隨時可以再改。</p>`,
    actions: [
      { label: '存起來', onClick: (el) => {
        const v = el.querySelector('#rename').value.trim();
        state.renameIsland(meta.island_id, v || meta.default_name);
        onDone?.();
      } },
      { label: '取消', className: 'btn btn--ghost', onClick: () => onDone?.() },
    ],
  });
}

/* ──────────────── 航海圖 ──────────────── */
export function atlasPanel(sheet, { state, onPlay }) {
  const rows = state.atlas().map((a) => {
    const pips = a.routes.map((r) => `<span class="atlas__pip${r.found ? ' is-found' : ''}" title="${esc(r.label)}"></span>`).join('');
    return `<div class="atlas__row">
      <div class="atlas__num">${a.order}</div>
      <div class="atlas__main">
        <div class="atlas__name">${esc(a.unlocked ? a.name : '還沒探索')}</div>
        <div class="atlas__story">《${esc(a.title)}》${a.unlocked ? `　・　走過 ${a.plays} 次` : ''}</div>
        <div class="atlas__routes">${pips}</div>
      </div>
      <button type="button" class="hud__btn" data-story="${a.story_id}">${a.unlocked ? '再走' : '出航'}</button>
    </div>`;
  }).join('');
  const found = state.atlas().reduce((s, a) => s + a.routes.filter((r) => r.found).length, 0);
  const el = sheet.open({
    title: '航海圖',
    subtitle: `已發現航線 ${found}／18`,
    body: rows + '<p class="tiny" style="margin-top:14px">每座島有三條航線。航線由故事的固定規則判定，不同的選擇組合可能走到同一條。</p>',
  });
  el.querySelectorAll('[data-story]').forEach((b) =>
    b.addEventListener('click', () => onPlay(b.dataset.story)));
}

/* ──────────────── 收藏 ──────────────── */
export function collectionPanel(sheet, { state }) {
  const { cards, keepsakes } = state.collection();
  const cardHtml = cards.length ? cards.map((c) => `
    <div class="card card--practice">
      <div class="card__kicker">${esc(c.title)}　・　約 ${c.duration_minutes} 分鐘</div>
      <p class="card__text">${esc(c.subtitle)}</p>
      <ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="card__note">${esc(c.note)}</p>
    </div>`).join('') : '<p class="muted">還沒有練習卡。走完一篇故事就會拿到一張。</p>';
  const keepHtml = keepsakes.length ? `<ul>${keepsakes.map((k) =>
    `<li><b>${esc(k.name)}</b>　<span class="tiny">${esc(k.description)}</span></li>`).join('')}</ul>`
    : '<p class="muted">還沒有紀念物。完成一次心情溫度計就會有。</p>';
  sheet.open({
    title: '長椅上的收藏',
    subtitle: `練習卡 ${cards.length}／18　・　紀念物 ${keepsakes.length}`,
    body: `<div class="section-label">情緒練習卡</div>${cardHtml}
           <div class="section-label">每週紀念物</div>${keepHtml}`,
  });
}

/* ──────────────── 關於 ──────────────── */
export function aboutPanel(sheet, { content }) {
  const s = content.dailyWeekly.safety;
  sheet.open({
    title: '關於透中島',
    subtitle: '中午十二點的島。太陽最高的時候，影子最短。',
    body: `
      <div class="card">
        <p class="card__text">名字來自台語的「透中晝」。\n\n每天只需要一下：在雲朵那裡決定今天島上的天氣。有興趣的時候，再走一趟 3 分鐘的故事。\n\n不強制每天玩，沒有連續紀錄的壓力，沒有標準答案。</p>
      </div>
      <div class="card">
        <div class="card__kicker">這款遊戲不做的事</div>
        <ul>
          <li>不做心理診斷，也不判斷你有沒有任何狀況。</li>
          <li>不評價你的選擇對錯。每一條航線都只是你這次走過的路。</li>
          <li>AI 回饋只看你這一次的選擇與結局，不生成劇情、不改變航線。</li>
          <li>個人的故事選擇、心情紀錄與 AI 回饋，不會提供給雇主辨識個別員工。</li>
        </ul>
      </div>
      <div class="card card--safety">
        <div class="card__kicker">需要的時候</div>
        <p class="card__text">${esc(s.intro)}</p>
        <ul>${s.resources.map((r) => `<li><b>${esc(r.name)}</b>　${esc(r.contact)}　${esc(r.hours)}</li>`).join('')}</ul>
      </div>`,
  });
}

/* ──────────────── 保存紀錄（E8） ──────────────── */

/** 代碼卡：把代碼畫成一張圖存進相簿，比抄在紙上可靠。 */
function codeCardBlob(code, when) {
  const W = 1000; const H = 560;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#b7deea');
  sky.addColorStop(1, '#fff0d3');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  g.fillStyle = '#fcf8ef';
  const m = 44; const r = 28;
  g.beginPath();
  g.roundRect(m, m, W - m * 2, H - m * 2, r);
  g.fill();

  g.fillStyle = '#83958b';
  g.font = '500 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('透中島 ・ 保存代碼', W / 2, 136);

  g.fillStyle = '#395a51';
  g.font = '700 92px ui-monospace, "SF Mono", Menlo, monospace';
  g.fillText(code, W / 2, 262);

  g.strokeStyle = '#e3e5d9'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(m + 60, 310); g.lineTo(W - m - 60, 310); g.stroke();

  g.fillStyle = '#83958b';
  g.font = '400 26px system-ui, sans-serif';
  g.fillText('還原時要「代碼」加上你自己設的「密碼」', W / 2, 362);
  g.fillStyle = '#c2604a';
  g.fillText('密碼沒有寫在這張圖上，也沒有人能幫你找回來', W / 2, 406);
  g.fillStyle = '#a8b4ab';
  g.font = '400 22px system-ui, sans-serif';
  g.fillText(when, W / 2, 462);

  return new Promise((res) => c.toBlob(res, 'image/png'));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 保存紀錄。
 *
 * 兩條路，都留著：
 *   備份檔  —— 一定行得通，檔案在自己手上，但得自己保管。
 *   保存代碼 —— 換手機只要記得代碼跟密碼，但要站台真的開了儲存空間。
 * 伺服器收到的永遠是加密過的密文，沒有密碼誰都打不開——包括我們。
 */
export function backupPanel(sheet, { state, vaultClient, onRestored }) {
  const today = new Date().toISOString().slice(0, 10);

  sheet.open({
    title: '換手機也要留著',
    subtitle: '紀錄現在只存在這台裝置的瀏覽器裡',
    body: `
      <div class="card">
        <p class="card__text">清掉瀏覽器資料、換手機、用無痕視窗，島上的一切就會不見。下面兩個方法都可以把它帶走。</p>
      </div>

      <div class="section-label">方法一　下載備份檔</div>
      <p class="muted">存成一個檔案放在自己手上，最穩，但要記得它放在哪。</p>
      <div class="row-btns">
        <button type="button" class="btn btn--ghost" id="bk-export">下載備份檔</button>
        <button type="button" class="btn btn--ghost" id="bk-import">讀回備份檔</button>
      </div>
      <input type="file" id="bk-file" accept="application/json,.json" hidden />

      <div class="section-label">方法二　保存代碼</div>
      <p class="muted">拿一組代碼、自己設一個密碼。換手機時輸入這兩樣就能把島接回來。</p>
      <p class="tiny">存檔會<b>在這台裝置上先加密</b>才上傳，伺服器只收得到一團看不懂的密文。沒有帳號、不用 email。<b>密碼忘記就真的解不開</b>，我們也沒有辦法幫你還原。</p>
      <div class="row-btns">
        <button type="button" class="btn" id="bk-make">產生保存代碼</button>
        <button type="button" class="btn btn--ghost" id="bk-restore">用代碼還原</button>
      </div>
      <div id="bk-msg"></div>`,
    actions: [{ label: '關起來', className: 'btn btn--ghost', onClick: () => sheet.close() }],
  });

  const el = sheet.mount;
  const msg = el.querySelector('#bk-msg');
  const say = (text, tone = 'muted') => {
    msg.innerHTML = text ? `<p class="${tone}" style="margin-top:12px">${esc(text)}</p>` : '';
  };

  el.querySelector('#bk-export').addEventListener('click', () => {
    download(new Blob([state.exportJSON()], { type: 'application/json' }),
      `透中島-備份-${today}.json`);
    say('備份檔下載好了。換裝置時用「讀回備份檔」把它讀回來。');
  });

  const file = el.querySelector('#bk-file');
  el.querySelector('#bk-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.save_version) throw new Error('這不是《透中島》的備份檔。');
      confirmRestore(sheet, { state, data, onRestored });
    } catch (e) {
      say(e.message ?? '讀不開這個檔案。', 'tiny');
    }
  });

  el.querySelector('#bk-make').addEventListener('click', () => makeCodePanel(sheet, { state, vaultClient }));
  el.querySelector('#bk-restore').addEventListener('click', () => restorePanel(sheet, { state, vaultClient, onRestored }));
}

function makeCodePanel(sheet, { state, vaultClient }) {
  sheet.open({
    title: '產生保存代碼',
    subtitle: '設一個你記得住的密碼',
    mini: true,
    body: `
      <div class="section-label">密碼</div>
      <input class="field" id="bk-pw" type="password" autocomplete="new-password" placeholder="至少 6 個字" />
      <div class="section-label">再打一次</div>
      <input class="field" id="bk-pw2" type="password" autocomplete="new-password" />
      <p class="tiny" style="margin-top:10px">這個密碼只留在你腦袋裡。它不會上傳，伺服器也沒有辦法驗證或重設它——忘記了，那份備份就永遠打不開。</p>
      <div id="bk-msg2"></div>`,
    actions: [
      { label: '產生代碼', onClick: go },
      { label: '返回', className: 'btn btn--ghost', onClick: () => backupPanel(sheet, { state, vaultClient }) },
    ],
  });

  async function go(el) {
    const msg = el.querySelector('#bk-msg2');
    const say = (t, tone = 'tiny') => { msg.innerHTML = t ? `<p class="${tone}" style="margin-top:10px">${esc(t)}</p>` : ''; };
    const pw = el.querySelector('#bk-pw').value;
    const pw2 = el.querySelector('#bk-pw2').value;
    if (pw.length < 6) return say('密碼至少要 6 個字。');
    if (pw !== pw2) return say('兩次打的不一樣。');
    const btn = el.querySelector('.sheet__foot .btn');
    btn.disabled = true;
    say('加密中…', 'muted');
    try {
      const out = await vaultClient.backup(state.exportJSON(), pw);
      showCode(sheet, { state, vaultClient, code: out.code, durable: out.durable });
    } catch (e) {
      btn.disabled = false;
      say(e.message ?? '上傳失敗。你還是可以用「下載備份檔」把紀錄帶走。');
    }
    return undefined;
  }
}

function showCode(sheet, { state, vaultClient, code, durable }) {
  const when = new Date().toISOString().slice(0, 10);
  sheet.open({
    title: '保存代碼',
    subtitle: '抄下來，或存成圖片',
    body: `
      <div class="code-card"><span class="code-card__code">${esc(code)}</span></div>
      <p class="muted">還原時要輸入這組代碼，加上你剛剛設的密碼。</p>
      <p class="tiny">密碼不在代碼裡，也不在圖片上。兩樣都要有才打得開。</p>
      ${durable ? '' : `<div class="card" style="margin-top:12px">
        <p class="card__text">這個站台的雲端儲存還沒開，所以這份備份只會留在伺服器的記憶體裡，重開就沒了。
        請改用「下載備份檔」，或請管理者在 Netlify 開啟 Blobs。</p></div>`}`,
    actions: [
      { label: '存成圖片', className: 'btn btn--ghost', onClick: async () => {
        const blob = await codeCardBlob(code, `${when} 建立`);
        if (blob) download(blob, `透中島-保存代碼-${code}.png`);
      } },
      { label: '好了', onClick: () => backupPanel(sheet, { state, vaultClient }) },
    ],
  });
}

function restorePanel(sheet, { state, vaultClient, onRestored }) {
  sheet.open({
    title: '用代碼還原',
    subtitle: '輸入代碼與密碼',
    mini: true,
    body: `
      <div class="section-label">保存代碼</div>
      <input class="field" id="rs-code" placeholder="TTI-XXXX-XXXX" autocapitalize="characters" spellcheck="false" />
      <div class="section-label">密碼</div>
      <input class="field" id="rs-pw" type="password" autocomplete="current-password" />
      <p class="tiny" style="margin-top:10px">還原會把這台裝置現在的紀錄整份換掉。換之前可以先下載一份備份檔。</p>
      <div id="rs-msg"></div>`,
    actions: [
      { label: '還原', onClick: go },
      { label: '返回', className: 'btn btn--ghost', onClick: () => backupPanel(sheet, { state, vaultClient, onRestored }) },
    ],
  });

  async function go(el) {
    const msg = el.querySelector('#rs-msg');
    const say = (t, tone = 'tiny') => { msg.innerHTML = t ? `<p class="${tone}" style="margin-top:10px">${esc(t)}</p>` : ''; };
    const btn = el.querySelector('.sheet__foot .btn');
    btn.disabled = true;
    say('解開中…', 'muted');
    try {
      const { plaintext } = await vaultClient.restore(
        el.querySelector('#rs-code').value, el.querySelector('#rs-pw').value,
      );
      const data = JSON.parse(plaintext);
      if (!data.save_version) throw new Error('備份內容看起來不完整。');
      confirmRestore(sheet, { state, data, onRestored });
    } catch (e) {
      btn.disabled = false;
      say(e.message ?? '還原失敗。');
    }
  }
}

/** 還原會蓋掉現在的進度，所以先把兩邊有什麼攤開來讓人自己比。 */
function confirmRestore(sheet, { state, data, onRestored }) {
  const count = (d) => ({
    islands: Object.values(d.islands ?? {}).filter((i) => i.unlocked).length,
    routes: Object.values(d.islands ?? {}).reduce((n, i) => n + (i.routes?.length ?? 0), 0),
    days: Object.keys(d.daily ?? {}).length,
  });
  const now = count(state.data);
  const next = count(data);
  const row = (label, a, b) =>
    `<div class="band"><span style="min-width:96px" class="muted">${label}</span>
      <span>現在 <b>${a}</b>　→　還原後 <b>${b}</b></span></div>`;

  sheet.open({
    title: '確定要還原嗎',
    subtitle: '這台裝置現在的紀錄會被整份換掉',
    mini: true,
    body: `
      ${row('解鎖的島', now.islands, next.islands)}
      ${row('發現的航線', now.routes, next.routes)}
      ${row('打卡天數', now.days, next.days)}
      <p class="tiny" style="margin-top:12px">換掉之後不能復原。備份裡沒走完的故事不會帶過來。</p>`,
    actions: [
      { label: '換成備份的紀錄', onClick: () => {
        state.replaceAll(data);
        sheet.open({
          title: '接回來了',
          mini: true,
          body: `<p class="card__text">島上的 ${next.islands} 座島、${next.routes} 條航線都回來了。</p>`,
          actions: [{ label: '好', onClick: () => { sheet.close(); onRestored?.(); } }],
        });
      } },
      { label: '先不要', className: 'btn btn--ghost', onClick: () => sheet.close() },
    ],
  });
}
