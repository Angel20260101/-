/**
 * 故事結算。固定順序：
 *   固定劇情結局 → 航線解析 → 情緒練習卡 → 可選 AI 個人化回饋 → 島嶼探索成果
 *
 * 前三段永遠是預先寫好的內容，不經過 AI。AI 只在玩家按下按鈕、而且同意之後才呼叫，
 * 失敗時自動換成固定文案，畫面長得一樣。
 */
import { buildRequest, requestFeedback, fallbackFor } from '../core/aiFeedback.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class ResultView {
  constructor({ mount, content, state, onDone }) {
    this.mount = mount;
    this.content = content;
    this.state = state;
    this.onDone = onDone;
  }

  open({ recap, ending, route, story }) {
    this.recap = recap;
    this.ending = ending;
    this.route = route;
    this.story = story;
    this.card = this.content.cardById(route.practice_card_id);
    this.island = this.content.islandForStory(story.story_id);

    this.outcome = this.state.completeStory({
      storyId: story.story_id,
      islandId: story.island_id,
      routeId: route.route_id,
      endingId: ending.ending_id,
      cardId: route.practice_card_id,
    });

    this.mount.hidden = false;
    this.mount.replaceChildren();
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
      <div class="sheet__head">
        <div>
          <h2 class="sheet__title">《${esc(story.title)}》</h2>
          <p class="sheet__sub">第 ${this.outcome.plays} 次走完這座島</p>
        </div>
      </div>
      <div class="sheet__body" id="result-body"></div>
      <div class="sheet__foot" id="result-foot"></div>`;
    this.mount.appendChild(sheet);
    this.body = sheet.querySelector('#result-body');
    this.foot = sheet.querySelector('#result-foot');

    this.stage = 0;
    this._renderStage();
  }

  _button(label, fn, cls = 'btn') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  _append(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) this.body.appendChild(div.firstChild);
    this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
  }

  _next() { this.stage += 1; this._renderStage(); }

  _renderStage() {
    this.foot.replaceChildren();
    switch (this.stage) {
      case 0: return this._stageEnding();
      case 1: return this._stageRoute();
      case 2: return this._stagePractice();
      case 3: return this._stageAI();
      default: return this._stageIsland();
    }
  }

  // 1 ── 結局回顧
  _stageEnding() {
    const list = this.recap.choices.map((c) => `
      <li>
        <div class="recap__node">${esc(c.node_title)}</div>
        <div class="recap__choice">${esc(c.choice_text)}</div>
        <div class="recap__consequence">${esc(c.consequence)}</div>
      </li>`).join('');
    this._append(`
      <div class="result__ending">結局</div>
      <div class="result__title">${esc(this.ending.title)}</div>
      <div class="card">
        <p class="card__text">${esc(this.ending.recap.summary)}</p>
        <ul class="recap">${list}</ul>
        ${this.ending.recap.closing ? `<p class="card__note">${esc(this.ending.recap.closing)}</p>` : ''}
      </div>`);
    this.foot.appendChild(this._button('看航線解析', () => this._next()));
  }

  // 2 ── 航線解析
  _stageRoute() {
    const newTag = this.outcome.newRoute ? '<span class="card__tag">新發現</span>' : '<span class="card__tag">已探索過</span>';
    this._append(`
      <div class="card card--route">
        <div class="card__kicker">航線解析</div>
        <h3 class="card__title">${esc(this.route.name)}${newTag}</h3>
        <p class="card__text">${esc(this.route.narrative_explain)}</p>
        <p class="card__note">判定方式：依這篇故事的固定規則決定，不同的選擇組合可能走到同一條航線。航線代表你這一次走過的路，不代表好壞。</p>
      </div>`);
    this.foot.appendChild(this._button('收下情緒練習卡', () => this._next()));
  }

  // 3 ── 情緒練習卡
  _stagePractice() {
    const steps = this.card.steps.map((s) => `<li>${esc(s)}</li>`).join('');
    this._append(`
      <div class="card card--practice">
        <div class="card__kicker">情緒練習卡 ・ 約 ${this.card.duration_minutes} 分鐘</div>
        <h3 class="card__title">${esc(this.card.title)}</h3>
        <p class="card__text">${esc(this.card.subtitle)}</p>
        <p class="card__note">${esc(this.card.why)}</p>
        <ol>${steps}</ol>
        <p class="card__note"><b>什麼時候用：</b>${esc(this.card.when_to_use)}</p>
        <p class="card__note">${esc(this.card.note)}</p>
        <p class="tiny">卡片已收進長椅上的收藏。沒有做也沒關係，它不會過期。</p>
      </div>`);
    this.foot.appendChild(this._button('看看 AI 怎麼說（可跳過）', () => this._next(), 'btn btn--ghost'));
    this.foot.appendChild(this._button('直接看島嶼', () => { this.stage = 4; this._renderStage(); }));
  }

  // 4 ── AI 個人化回饋（選配）
  _stageAI() {
    const consent = this.state.settings.ai_feedback_consent;
    this._append(`
      <div class="card card--ai" id="ai-card">
        <div class="card__kicker">AI 個人化回饋 ・ 選配</div>
        <h3 class="card__title">想聽聽另一個角度嗎？</h3>
        <p class="card__text">AI 只會看到這一次的選擇、結局與航線。它不會改寫劇情、不會改變航線、不會評價你的選擇，也不會做任何心理判斷。</p>
        <p class="card__note">送出的內容：故事名稱與主題、你這次的三個選擇與後果、結局、航線。<b>不會送出</b>你的每日心情紀錄、心情溫度計分數、島嶼名稱或任何帳號資訊。</p>
        <div class="section-label">想補一句話嗎？（可以留白）</div>
        <textarea class="field" id="ai-note" rows="3" maxlength="500" placeholder="例如：我現實中也遇到類似的事⋯⋯"></textarea>
        <p class="tiny">填了才會送出這段文字，而且只用於這一次回饋。</p>
      </div>`);
    const run = async () => {
      const note = this.body.querySelector('#ai-note')?.value?.trim();
      this.state.setSetting('ai_feedback_consent', true);
      this.foot.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'muted';
      loading.innerHTML = '<span class="spinner"></span>正在讀你這一趟走過的路⋯⋯';
      this.foot.appendChild(loading);

      const req = buildRequest({
        story: this.story, ending: this.ending, route: this.route,
        recap: this.recap, card: this.card, playerNote: note, useNote: Boolean(note),
      });
      let data;
      try {
        data = await requestFeedback(req, {
          aiContent: this.content.aiFeedback,
          safetyConfig: this.content.dailyWeekly.safety,
        });
      } catch {
        data = fallbackFor(this.route.route_id, this.content.aiFeedback);
      }
      this._renderFeedback(data);
    };
    this.foot.appendChild(this._button(consent === true ? '產生回饋' : '同意並產生回饋', run));
    this.foot.appendChild(this._button('跳過', () => this._next(), 'btn btn--quiet'));
  }

  _renderFeedback(data) {
    const card = this.body.querySelector('#ai-card');
    if (data.type === 'safety') {
      const rows = data.safety.resources.map((r) =>
        `<li><b>${esc(r.name)}</b>　${esc(r.contact)}${r.hours ? `　${esc(r.hours)}` : ''}${r.note ? `<br><span class="tiny">${esc(r.note)}</span>` : ''}</li>`).join('');
      card.outerHTML = `
        <div class="card card--safety">
          <div class="card__kicker">想先跟你說一件事</div>
          <p class="card__text">${esc(data.safety.message)}</p>
          <ul>${rows}</ul>
          ${data.safety.closing ? `<p class="card__note">${esc(data.safety.closing)}</p>` : ''}
        </div>`;
      this.foot.replaceChildren(this._button('好', () => this._next()));
      return;
    }

    const voices = data.possible_inner_voice.map((v) => `<li>${esc(v)}</li>`).join('');
    const steps = data.small_practice.steps.map((s) => `<li>${esc(s)}</li>`).join('');
    const label = data.meta?.source === 'fallback'
      ? `<p class="tiny">${esc(this.content.aiFeedback.fallback.ui_label)}</p>` : '';
    card.outerHTML = `
      <div class="card card--ai">
        <div class="card__kicker">AI 個人化回饋</div>
        <h3 class="card__title">可能的心聲</h3>
        <ul>${voices}</ul>
        <h3 class="card__title" style="margin-top:14px">另一個角度</h3>
        <p class="card__text">${esc(data.another_view)}</p>
        <h3 class="card__title" style="margin-top:14px">一個小練習：${esc(data.small_practice.title)}</h3>
        <ol>${steps}</ol>
        ${data.closing ? `<p class="card__note">${esc(data.closing)}</p>` : ''}
        ${label}
      </div>`;
    this.foot.replaceChildren(this._button('看島嶼變化', () => this._next()));
  }

  // 5 ── 島嶼探索成果
  _stageIsland() {
    const o = this.outcome;
    const islandName = this.state.islandState(this.story.island_id).name || this.island.default_name;
    let growthHtml = '';
    if (o.growth) {
      growthHtml = `
        <h3 class="card__title">${esc(o.growth.label)}</h3>
        <p class="card__text">${esc(o.growth.unlock_line)}</p>
        <p class="card__note">${esc(o.growth.description)}</p>`;
    } else {
      growthHtml = `
        <h3 class="card__title">島上沒有新的變化</h3>
        <p class="card__text">這條航線你之前走過了，所以地景沒有重複增加。\n島上的東西不會因為重走而消失，也不會因為你沒來而退化。</p>`;
    }
    this._append(`
      <div class="card card--growth">
        <div class="card__kicker">島嶼探索成果 ・ ${esc(islandName)}</div>
        ${growthHtml}
        <p class="card__note">已發現航線 ${o.discovered} ／ ${o.total}。剩下的航線要換一種走法才會出現。</p>
      </div>`);

    if (o.needsNaming) {
      this._append(`
        <div class="card">
          <div class="card__kicker">替這座島取個名字</div>
          <p class="card__text">${esc(this.island.name_hint)}</p>
          <input class="field" id="island-name" maxlength="12" placeholder="${esc(this.island.default_name)}" />
        </div>`);
      this.foot.appendChild(this._button('命名並回到地圖', () => {
        const value = this.body.querySelector('#island-name')?.value?.trim();
        this.state.renameIsland(this.story.island_id, value || this.island.default_name);
        this._finish();
      }));
      this.foot.appendChild(this._button('之後再取', () => {
        this.state.renameIsland(this.story.island_id, this.island.default_name);
        this._finish();
      }, 'btn btn--quiet'));
      return;
    }

    const hints = this.story.replay_hints ?? [];
    if (hints.length) {
      this._append(`
        <div class="card">
          <div class="card__kicker">重走一次可以探索的</div>
          <ul>${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        </div>`);
    }
    this.foot.appendChild(this._button('回到地圖', () => this._finish()));
  }

  _finish() {
    this.mount.hidden = true;
    this.mount.replaceChildren();
    this.onDone?.(this.outcome);
  }
}
