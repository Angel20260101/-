/**
 * 故事播放畫面。
 *
 * 兩件事決定使用者會不會讀下去：
 *   1. 每個節點上方都有一張場景圖——先看到自己在哪裡，文字才有地方落腳。
 *   2. 一次把整段話放出來（逐句淡入），而不是一句一點。
 *      一篇故事的點擊次數因此從三十幾次降到十幾次。
 *
 * 這個畫面開啟時 3D 地圖會 pause()，完全不渲染。
 * 每一次節點推進與每一次選擇都會立刻存檔，中途離開可以原地接續。
 */
import {
  createSession, presentNode, advance, choose, indexNodes, buildRecap,
} from '../core/storyEngine.js';
import { sceneArt, artKeyFor } from './sceneArt.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export class StoryView {
  constructor({ mount, onFinish, onQuit, onSave }) {
    this.mount = mount;
    this.onFinish = onFinish;
    this.onQuit = onQuit;
    this.onSave = onSave;
    this.el = null;
  }

  open(story, session = null) {
    this.story = story;
    this.nodes = indexNodes(story);
    this.ctx = session ?? createSession(story);
    this.names = Object.fromEntries(story.characters.map((c) => [c.character_id, c.name]));
    this.totalDecisions = story.nodes.filter((n) => n.node_type === 'decision').length;
    this.artKey = null;

    this.el = document.createElement('div');
    this.el.className = 'story';
    this.el.innerHTML = `
      <div class="story__top">
        <div class="story__scene" id="story-scene"></div>
        <button type="button" class="story__quit">離開</button>
      </div>
      <div class="art" id="story-art"></div>
      <div class="story__body" id="story-body"></div>
      <div class="story__foot" id="story-foot"></div>`;
    this.mount.appendChild(this.el);
    this.body = this.el.querySelector('#story-body');
    this.foot = this.el.querySelector('#story-foot');
    this.sceneEl = this.el.querySelector('#story-scene');
    this.artEl = this.el.querySelector('#story-art');

    this.el.querySelector('.story__quit').addEventListener('click', () => {
      this.onSave?.(this.ctx);
      this.onQuit?.();
    });

    this._enterNode();
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  /** 換場景圖。同一個場景不重畫，換場時淡入。 */
  _paintArt(scene) {
    if (!scene) return;
    const key = artKeyFor(scene);
    const stamp = `${key}|${scene.time ?? ''}`;
    if (stamp === this.artKey) return;
    this.artKey = stamp;
    this.artEl.innerHTML = sceneArt(scene);
    this.artEl.classList.remove('is-in');
    void this.artEl.offsetWidth;        // 重跑動畫
    this.artEl.classList.add('is-in');
  }

  // ── 節點流程 ────────────────────────────────────────────
  _enterNode() {
    const { node, dialogue, choices } = presentNode(this.story, this.ctx, this.nodes);
    this.node = node;
    this.choices = choices;
    if (node.scene) {
      const bits = [node.scene.location, node.scene.time].filter(Boolean);
      this.sceneEl.innerHTML = `<b>${esc(bits[0] ?? '')}</b>${bits[1] ? ' ・ ' + esc(bits[1]) : ''}`;
      this._paintArt(node.scene);
    }
    this.body.replaceChildren();
    this._renderAll(dialogue);
    this._showActions();
  }

  /** 一次放出整段話，逐句淡入。 */
  _renderAll(lines, startDelay = 0) {
    lines.forEach((l, i) => this._render(l, startDelay + i * 70));
    this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
  }

  _continue(label, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = label;
    btn.addEventListener('click', fn);
    this.foot.replaceChildren(btn);
    this.foot.appendChild(this._progress());
  }

  _showActions() {
    this.foot.replaceChildren();
    if (this.node.node_type === 'decision') {
      const wrap = document.createElement('div');
      wrap.className = 'choices';
      for (const c of this.choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'choice';
        btn.innerHTML = `<span class="choice__text">${esc(c.text)}</span>${
          c.hint ? `<span class="choice__hint">${esc(c.hint)}</span>` : ''}`;
        btn.addEventListener('click', () => this._choose(c.choice_id));
        wrap.appendChild(btn);
      }
      this.foot.appendChild(wrap);
      this.foot.appendChild(this._progress());
      return;
    }
    this._continue('繼續', () => this._advance());
  }

  _choose(choiceId) {
    const result = choose(this.story, this.ctx, choiceId, this.nodes);
    this.onSave?.(this.ctx);
    this.body.replaceChildren();
    this._renderAll(result.immediate);
    this.pendingClue = result.clue;
    this._continue('繼續', () => this._showClue());
  }

  /** 立即反應播完，才給心聲線索。 */
  _showClue() {
    if (!this.pendingClue) { this._enterNode(); return; }
    const clue = document.createElement('div');
    clue.className = 'clue';
    clue.innerHTML = `<div class="clue__title">${esc(this.pendingClue.title)}</div>
      <div class="clue__text">${esc(this.pendingClue.text)}</div>`;
    this.body.appendChild(clue);
    this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
    this.pendingClue = null;
    this._continue('繼續', () => this._enterNode());
  }

  _advance() {
    const step = advance(this.story, this.ctx, this.nodes);
    this.onSave?.(this.ctx);
    if (step?.kind === 'ending') { this._renderEnding(step); return; }
    this._enterNode();
  }

  _renderEnding(step) {
    this.body.replaceChildren();
    this.sceneEl.innerHTML = `<b>結局</b> ・ ${esc(step.ending.title)}`;
    this._renderAll(step.ending.dialogue);
    this._continue('看看這一趟走了什麼', () => this.onFinish?.({
      recap: buildRecap(this.story, this.ctx),
      ending: step.ending,
      route: step.route,
      story: this.story,
      ctx: this.ctx,
    }));
  }

  // ── 單句渲染 ────────────────────────────────────────────
  _render(line, delay = 0) {
    const p = document.createElement('p');
    const style = line.style ?? 'narration';
    p.className = `line line--${style}`;
    p.style.animationDelay = `${delay}ms`;
    const who = this.names[line.speaker];
    if (style === 'line' || style === 'message') {
      p.innerHTML = `<span class="line__who">${esc(who ?? line.speaker)}</span>
        <span class="line__text">${esc(line.text)}</span>`;
    } else {
      p.textContent = line.text;
    }
    this.body.appendChild(p);
  }

  _progress() {
    const wrap = document.createElement('div');
    wrap.className = 'progress';
    const done = this.ctx.chosen.length;
    for (let i = 0; i < this.totalDecisions; i++) {
      const dot = document.createElement('span');
      dot.className = `progress__dot${i < done ? ' is-done' : ''}`;
      wrap.appendChild(dot);
    }
    const label = document.createElement('span');
    label.className = 'progress__label';
    label.textContent = done >= this.totalDecisions
      ? '快到結局了'
      : `第 ${done + 1} 個選擇／共 ${this.totalDecisions} 個　・　約 ${this.story.estimated_minutes} 分鐘`;
    wrap.appendChild(label);
    return wrap;
  }
}
