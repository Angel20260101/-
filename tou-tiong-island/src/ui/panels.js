/**
 * 各種面板：島嶼、每日天氣打卡、每週心情溫度計、航海圖、收藏、關於。
 * 全部共用同一個底部抽屜樣式；手機上是半高抽屜，桌機上是置中卡片。
 */
import { scanForRisk, safetyPayload } from '../core/safety.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class Sheet {
  constructor(mount) {
    this.mount = mount;
    this.mount.addEventListener('click', (e) => {
      if (e.target === this.mount) this.close();
    });
  }

  open({ title, subtitle, body, actions = [], dismissable = true }) {
    this.mount.hidden = false;
    this.mount.replaceChildren();
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
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

  close() {
    this.mount.hidden = true;
    this.mount.replaceChildren();
    this.onClose?.();
  }
}

/** 島嶼面板：未解鎖 / 已解鎖 / 透中島 三種樣子。 */
export function islandPanel(sheet, { island, state, content, onPlay }) {
  if (island.kind === 'home') return homePanel(sheet, { island, content });

  const st = state.islandState(island.island_id);
  const meta = content.islandById(island.island_id);
  const story = content.storyIndex.find((s) => s.story_id === meta.story_id);
  const routes = meta.growth.map((g) => {
    const found = (st.routes ?? []).includes(g.route_id);
    return `<li>${found ? `<b>${esc(g.label)}</b>　<span class="tiny">已長出</span>`
      : '<span class="muted">？？？　還沒走到的航線</span>'}</li>`;
  }).join('');

  if (!st.unlocked) {
    sheet.open({
      title: '未標記的海域',
      subtitle: `第 ${meta.order} 座島`,
      body: `
        <div class="card">
          <div class="card__kicker">${esc(story.theme)}</div>
          <h3 class="card__title">《${esc(story.title)}》</h3>
          <p class="card__text">${esc(story.logline)}</p>
          <p class="card__note">約 ${story.estimated_minutes} 分鐘 ・ ${story.endings} 個結局 ・ 3 條航線</p>
          ${story.content_notes?.length ? `<p class="tiny">內容提醒：${story.content_notes.map(esc).join('、')}</p>` : ''}
        </div>
        <p class="muted">走完一次就會解鎖這座島，然後你可以替它取名字。</p>`,
      actions: [{ label: '出航', onClick: () => onPlay(meta.story_id) }],
    });
    return;
  }

  sheet.open({
    title: st.name || meta.default_name,
    subtitle: `《${story.title}》 ・ 走過 ${st.plays} 次 ・ 航線 ${st.routes.length}／${meta.growth.length}`,
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
      { label: '改名字', className: 'btn btn--ghost', onClick: () => renamePanel(sheet, { state, meta, onDone: () => islandPanel(sheet, { island, state, content, onPlay }) }) },
    ],
  });
}

function renamePanel(sheet, { state, meta, onDone }) {
  const current = state.islandState(meta.island_id).name || meta.default_name;
  sheet.open({
    title: '替這座島取名字',
    subtitle: meta.name_hint,
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

function homePanel(sheet, { island, content }) {
  const rows = island.interactions.map((i) =>
    `<div class="atlas__row"><div class="atlas__main">
      <div class="atlas__name">${esc(i.title)}</div>
      <div class="atlas__story">${esc(i.subtitle)}</div>
    </div></div>`).join('');
  sheet.open({
    title: island.name,
    subtitle: island.tagline,
    body: `<p class="muted">點島上的小圓點就能進去。</p>${rows}
           <p class="tiny" style="margin-top:14px">兩種任務都不強制完成，中斷了也不會有任何損失。</p>`,
  });
}

/** 每日任務：天氣心情打卡。 */
export function dailyPanel(sheet, { content, state, onSaved }) {
  const cfg = content.dailyWeekly.daily;
  const existing = state.todayCheckin();
  const moods = cfg.options.map((o) => `
    <button type="button" class="mood${existing?.mood_id === o.mood_id ? ' is-on' : ''}" data-mood="${o.mood_id}">
      <div class="mood__icon" aria-hidden="true">${iconFor(o.icon)}</div>
      <div class="mood__label">${esc(o.label)}</div>
      <div class="mood__desc">${esc(o.description)}</div>
    </button>`).join('');
  const scale = cfg.energy.scale.map((s) => `
    <button type="button" class="scale__btn${existing?.energy === s.value ? ' is-on' : ''}" data-energy="${s.value}">
      ${s.value}<br>${esc(s.label)}
    </button>`).join('');

  const sheetEl = sheet.open({
    title: cfg.title,
    subtitle: `${cfg.prompt}　${cfg.sub_prompt}`,
    body: `
      <div class="moods">${moods}</div>
      <div class="section-label">${esc(cfg.energy.prompt)}</div>
      <div class="scale">${scale}</div>
      <div class="section-label">${esc(cfg.note.placeholder)}</div>
      <textarea class="field" id="daily-note" rows="2" maxlength="140">${esc(existing?.note ?? '')}</textarea>
      <p class="tiny" style="margin-top:12px">${esc(cfg.streak_note)}</p>
      <div id="daily-safety"></div>`,
    actions: [{ label: existing ? '更新今天的紀錄' : '記下來', onClick: save }],
  });

  let mood = existing?.mood_id ?? null;
  let energy = existing?.energy ?? null;
  const btn = sheetEl.querySelector('.sheet__foot .btn');
  const sync = () => { btn.disabled = !mood; };
  sync();

  sheetEl.querySelectorAll('[data-mood]').forEach((el) => el.addEventListener('click', () => {
    mood = el.dataset.mood;
    sheetEl.querySelectorAll('[data-mood]').forEach((x) => x.classList.toggle('is-on', x === el));
    sync();
  }));
  sheetEl.querySelectorAll('[data-energy]').forEach((el) => el.addEventListener('click', () => {
    energy = Number(el.dataset.energy);
    sheetEl.querySelectorAll('[data-energy]').forEach((x) => x.classList.toggle('is-on', x === el));
  }));

  const noteEl = sheetEl.querySelector('#daily-note');
  const safetyBox = sheetEl.querySelector('#daily-safety');
  noteEl.addEventListener('input', () => {
    const risk = scanForRisk(noteEl.value, content.dailyWeekly.safety);
    safetyBox.innerHTML = risk.flagged ? safetyCardHtml(content.dailyWeekly.safety) : '';
  });

  function save() {
    const entry = state.saveCheckin({ moodId: mood, energy, note: noteEl.value });
    const closing = cfg.closing_lines[mood] ?? '';
    sheet.open({
      title: '記下來了',
      subtitle: cfg.reward.copy,
      body: `<div class="card"><p class="card__text">${esc(closing)}</p></div>
             ${recentStrip(state)}`,
      actions: [{ label: '回到島上', onClick: () => { sheet.close(); onSaved?.(entry); } }],
    });
  }
}

function recentStrip(state) {
  const rows = state.recentCheckins(14).map(({ date, entry }) => {
    const label = entry ? iconFor(moodIcon(entry.mood_id)) : '·';
    return `<span title="${date}" style="display:inline-block;width:22px;text-align:center;font-size:15px">${label}</span>`;
  }).join('');
  return `<div class="section-label">最近兩週</div><div style="line-height:1.6">${rows}</div>
          <p class="tiny">空白的日子就是沒有紀錄，沒有別的意思。</p>`;
}

const MOOD_ICONS = { sunny: 'sun', cloudy: 'cloud_sun', overcast: 'cloud', drizzle: 'drizzle', storm: 'storm', fog: 'fog', rainbow: 'rainbow' };
const moodIcon = (id) => MOOD_ICONS[id] ?? 'cloud';
function iconFor(key) {
  return { sun: '☀️', cloud_sun: '⛅', cloud: '☁️', drizzle: '🌦️', storm: '⛈️', fog: '🌫️', rainbow: '🌈' }[key] ?? '·';
}

function safetyCardHtml(safety) {
  const rows = safety.resources.map((r) =>
    `<li><b>${esc(r.name)}</b>　${esc(r.contact)}${r.hours ? `　${esc(r.hours)}` : ''}</li>`).join('');
  return `<div class="card card--safety" style="margin-top:14px">
      <div class="card__kicker">想先跟你說一件事</div>
      <p class="card__text">${esc(safety.intro)}${esc(safety.body)}</p>
      <ul>${rows}</ul>
      <p class="card__note">${esc(safety.closing)}</p>
    </div>`;
}

/** 每週任務：心情溫度計。 */
export function weeklyPanel(sheet, { content, state, onSaved }) {
  const cfg = content.dailyWeekly.weekly;
  const inst = cfg.instrument;
  const done = state.thisWeekEntry();

  const scaleButtons = (itemId) => inst.scale.map((s) =>
    `<button type="button" class="scale__btn" data-item="${itemId}" data-value="${s.value}">${s.value}<br>${esc(s.label)}</button>`).join('');
  const items = inst.items.map((it, i) => `
    <div class="q">
      <div class="q__text">${i + 1}. ${esc(it.text)}</div>
      <div class="scale">${scaleButtons(it.item_id)}</div>
    </div>`).join('');
  const safetyOpts = cfg.safety_item.options.map((o) =>
    `<button type="button" class="scale__btn" data-item="${cfg.safety_item.item_id}" data-value="${o.value}">${esc(o.label)}</button>`).join('');

  const el = sheet.open({
    title: cfg.title,
    subtitle: `${cfg.subtitle}　・　回想「${inst.recall_period}」`,
    body: `
      <p class="muted">${esc(inst.disclaimer)}</p>
      ${done ? '<p class="tiny">這週已經做過一次了，再做一次會覆蓋原本的紀錄。</p>' : ''}
      <div class="section-label">最近七天，下面這些狀況出現的頻率</div>
      ${items}
      <div class="section-label">還有一題</div>
      <div class="q">
        <div class="q__text">${esc(cfg.safety_item.text)}</div>
        <div class="scale">${safetyOpts}</div>
        <p class="tiny">${esc(cfg.safety_item.note)}</p>
      </div>
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
    if (item === cfg.safety_item.item_id) {
      safetyValue = value;
      el.querySelector('#weekly-safety').innerHTML =
        value >= cfg.safety_item.trigger_threshold ? safetyCardHtml(content.dailyWeekly.safety) : '';
    } else {
      answers[item] = value;
    }
    sync();
  }));

  function submit() {
    const score = Object.values(answers).reduce((a, b) => a + b, 0);
    const band = inst.bands.find((b) => score >= b.min && score <= b.max);
    const { keepsake } = state.saveThermometer({ answers, score, bandId: band.band_id, safetyValue });
    const safe = safetyValue >= cfg.safety_item.trigger_threshold ? safetyCardHtml(content.dailyWeekly.safety) : '';
    sheet.open({
      title: '這一週記錄下來了',
      subtitle: cfg.reward.copy,
      body: `
        <div class="card">
          <div class="card__kicker">${esc(band.label)}</div>
          <p class="card__text">${esc(band.copy)}</p>
          <p class="card__note">${esc(inst.disclaimer)}</p>
        </div>
        <div class="card">
          <div class="card__kicker">紀念物</div>
          <h3 class="card__title">${esc(keepsake.name)}</h3>
          <p class="card__text">${esc(keepsake.description)}</p>
          <p class="tiny">${esc(cfg.reward.rule)}</p>
        </div>
        ${safe}`,
      actions: [{ label: '回到島上', onClick: () => { sheet.close(); onSaved?.(); } }],
    });
  }
}

/** 航海圖：六座島與十八條航線的探索進度。 */
export function atlasPanel(sheet, { state, onPlay }) {
  const rows = state.atlas().map((a) => {
    const pips = a.routes.map((r) => `<span class="atlas__pip${r.found ? ' is-found' : ''}" title="${esc(r.label)}"></span>`).join('');
    return `<div class="atlas__row">
      <div class="atlas__num">${a.order}</div>
      <div class="atlas__main">
        <div class="atlas__name">${esc(a.unlocked ? a.name : '未標記的海域')}</div>
        <div class="atlas__story">《${esc(a.title)}》${a.unlocked ? ` ・ 走過 ${a.plays} 次` : ''}</div>
        <div class="atlas__routes">${pips}</div>
      </div>
      ${a.unlocked ? `<button type="button" class="hud__btn" data-story="${a.story_id}">再走</button>`
                   : `<button type="button" class="hud__btn" data-story="${a.story_id}">出航</button>`}
    </div>`;
  }).join('');
  const found = state.atlas().reduce((s, a) => s + a.routes.filter((r) => r.found).length, 0);
  const el = sheet.open({
    title: '航海圖',
    subtitle: `已發現航線 ${found} ／ 18`,
    body: rows + '<p class="tiny" style="margin-top:14px">每座島有三條航線。航線由故事的固定規則判定，不同的選擇組合可能走到同一條。</p>',
  });
  el.querySelectorAll('[data-story]').forEach((b) =>
    b.addEventListener('click', () => onPlay(b.dataset.story)));
}

/** 收藏：情緒練習卡與每週紀念物。 */
export function collectionPanel(sheet, { state }) {
  const { cards, keepsakes } = state.collection();
  const cardHtml = cards.length ? cards.map((c) => `
    <div class="card card--practice">
      <div class="card__kicker">${esc(c.title)} ・ 約 ${c.duration_minutes} 分鐘</div>
      <p class="card__text">${esc(c.subtitle)}</p>
      <ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="card__note">${esc(c.note)}</p>
    </div>`).join('') : '<p class="muted">還沒有練習卡。走完一篇故事就會拿到一張。</p>';
  const keepHtml = keepsakes.length ? `<ul>${keepsakes.map((k) =>
    `<li><b>${esc(k.name)}</b>　<span class="tiny">${esc(k.description)}</span></li>`).join('')}</ul>`
    : '<p class="muted">還沒有紀念物。完成一次心情溫度計就會有。</p>';
  sheet.open({
    title: '長椅上的收藏',
    subtitle: `練習卡 ${cards.length}／18 ・ 紀念物 ${keepsakes.length}`,
    body: `<div class="section-label">情緒練習卡</div>${cardHtml}
           <div class="section-label">每週紀念物</div>${keepHtml}`,
  });
}

/** 關於這款遊戲。 */
export function aboutPanel(sheet, { content }) {
  const safety = content.dailyWeekly.safety;
  sheet.open({
    title: '關於透中島',
    subtitle: '中午十二點的島。太陽最高的時候，影子最短。',
    body: `
      <div class="card">
        <p class="card__text">《透中島》的名字來自台語的「透中晝」——中午那段最亮、也最熱的時間。\n\n這裡每天只需要 30 秒：在碼頭記一下今天的天氣。有興趣的時候，再走一趟 3 分鐘的故事。\n\n不強制每天玩，沒有連續紀錄的壓力，沒有標準答案。</p>
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
      ${safetyCardHtml(safety)}`,
  });
}
