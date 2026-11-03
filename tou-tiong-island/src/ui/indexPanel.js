/**
 * 島嶼索引面板。
 *
 * 參考 puma.taipei 右側的 THE POLICY INDEX：標籤、標題、數量、搜尋框、編號清單。
 * 借的是結構，不是內容——他們索引的是政見，我們索引的是故事與帶得走的方法。
 *
 * 為什麼需要它：地圖上要找一座島只能用眼睛掃，而島會愈來愈多。有了索引，
 * 使用者可以「我想練習拒絕」直接搜到界線島，而不是先認得島的長相。
 * 搜尋範圍包含練習卡的名稱，所以「一句話的界線」也找得到——那才是人記得住的東西。
 *
 * 寬螢幕常駐在右側；窄螢幕收起來，由主選單的「清單」叫出。
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class IndexPanel {
  /**
   * @param root      <aside> 容器
   * @param content   內容包（故事索引、練習卡）
   * @param onPick    點一座島：(island_id) => void
   * @param onSpot    點一個常駐去處：(interaction_id) => void
   */
  constructor({ root, content, onPick, onSpot }) {
    this.root = root;
    this.content = content;
    this.onPick = onPick;
    this.onSpot = onSpot;
    this.query = '';
    this.islands = [];

    // 每座島可搜尋的練習卡文字。
    //
    // 只索引卡片標題是不夠的：人會用「我想拒絕」「喘不過氣」「還沒回覆」
    // 這種自己的說法來找，而那些字在 why / when_to_use / note 裡，
    // 不在「一句話的界線」這種標題上。實測搜「拒絕」找不到界線島就是這個原因——
    // 那個詞確實寫在它的卡片內文裡。
    this.cardsByIsland = new Map();
    this.textByIsland = new Map();
    for (const c of content.practiceCards?.cards ?? []) {
      const story = content.storyIndex.find((s) => s.routes.some((r) => r.route_id === c.route_id));
      if (!story) continue;
      const id = story.island_id;
      if (!this.cardsByIsland.has(id)) { this.cardsByIsland.set(id, []); this.textByIsland.set(id, []); }
      this.cardsByIsland.get(id).push(c.title);
      this.textByIsland.get(id).push(
        c.title, c.subtitle, c.why, c.when_to_use, c.note,
        ...(Array.isArray(c.steps) ? c.steps : []),
      );
    }

    this._mount();
  }

  _mount() {
    const total = this.content.storyIndex.length;
    const routes = this.content.storyIndex.reduce((n, s) => n + s.routes.length, 0);
    this.root.innerHTML = `
      <div class="index__inner">
        <div class="index__label">THE ISLAND INDEX</div>
        <h2 class="index__title">走一座島，帶走一個方法。</h2>
        <p class="index__sub">${total} 座故事島／${routes} 條航線<br>選一座島，走進它的故事。</p>
        <input type="search" class="index__search" placeholder="搜尋島嶼、方法、關鍵字…"
               aria-label="搜尋島嶼與方法">
        <div class="index__list" role="list"></div>
        <div class="index__spots"></div>
      </div>`;
    this.listEl = this.root.querySelector('.index__list');
    this.spotsEl = this.root.querySelector('.index__spots');
    const search = this.root.querySelector('.index__search');
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this._renderList();
    });
    this._renderSpots();
  }

  /** 世界重建之後呼叫，把最新的解鎖狀態與命名帶進來。 */
  update(islands) {
    this.islands = islands ?? [];
    this._renderList();
  }

  _match(story, island) {
    if (!this.query) return true;
    const hay = [
      island?.name, story.title, story.subtitle, story.theme, story.logline,
      ...(this.textByIsland.get(story.island_id) ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(this.query);
  }

  _renderList() {
    const byId = new Map(this.islands.map((i) => [i.island_id, i]));
    const rows = this.content.storyIndex
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ s, island: byId.get(s.island_id) }))
      .filter(({ s, island }) => this._match(s, island));

    if (!rows.length) {
      this.listEl.innerHTML = '<p class="index__empty">沒有符合的島。換個說法試試，或直接在地圖上找。</p>';
      return;
    }

    this.listEl.innerHTML = rows.map(({ s, island }) => {
      const open = island?.unlocked;
      // 未破關的島不劇透故事標題——那是走進去才看得到的東西
      const name = open ? (island.name || s.title) : '未探索';
      const sub = open
        ? `${esc(s.title)}　・　航線 ${island.growthCount}／${island.growthTotal}`
        : esc(s.subtitle ?? s.theme);
      return `
        <button type="button" class="index__row${open ? '' : ' is-locked'}"
                role="listitem" data-island="${esc(s.island_id)}">
          <span class="index__no">${String(s.order).padStart(2, '0')}</span>
          <span class="index__main">
            <span class="index__name">${esc(name)}</span>
            <span class="index__meta">${sub}</span>
          </span>
          <span class="index__go" aria-hidden="true">↗</span>
        </button>`;
    }).join('');

    for (const el of this.listEl.querySelectorAll('[data-island]')) {
      el.addEventListener('click', () => this.onPick?.(el.dataset.island));
    }
  }

  /** 常駐去處。它們不是故事，但使用者會想直接到——所以跟島分開列。 */
  _renderSpots() {
    const SPOTS = [
      ['lighthouse', '燈塔', '隨時可以點，不必說原因'],
      ['wish', '碼頭許願', '寫下希望工作環境改變什麼'],
      ['letter', '時光郵局', '寫給未來的自己'],
      ['records', '我的紀錄', '天氣、溫度計、收藏'],
    ];
    this.spotsEl.innerHTML = `
      <div class="index__label index__label--sub">常駐去處</div>
      ${SPOTS.map(([id, name, sub]) => `
        <button type="button" class="index__row index__row--spot" data-spot="${id}">
          <span class="index__main">
            <span class="index__name">${esc(name)}</span>
            <span class="index__meta">${esc(sub)}</span>
          </span>
          <span class="index__go" aria-hidden="true">↗</span>
        </button>`).join('')}`;
    for (const el of this.spotsEl.querySelectorAll('[data-spot]')) {
      el.addEventListener('click', () => this.onSpot?.(el.dataset.spot));
    }
  }

  toggle(force) {
    const open = force ?? !this.root.classList.contains('is-open');
    this.root.classList.toggle('is-open', open);
    return open;
  }
}
