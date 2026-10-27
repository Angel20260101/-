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

/* ──────────────── 我的紀錄（E9） ──────────────── */
export function recordsPanel(sheet, { state, content, onAtlas, onCollection }) {
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
      <p class="muted">放出去的小船 ${wishes} 艘　・　郵局裡的信 ${letters} 封</p>`,
    actions: [
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
