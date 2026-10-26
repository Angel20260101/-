/**
 * 故事播放畫面。
 *
 * 一次顯示一句，點畫面任何地方繼續；走到決策點就換成選項。
 * 這個畫面開啟時，3D 地圖會被 pause()，完全不渲染。
 * 每一次節點推進與每一次選擇都會立刻存檔，中途離開可以原地接續。
 */
import {
  createSession, presentNode, advance, choose, indexNodes, buildRecap,
} from '../core/storyEngine.js';

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

    this.el = document.createElement('div');
    this.el.className = 'story';
    this.el.innerHTML = `
      <div class="story__top">
        <div class="story__scene" id="story-scene"></div>
        <button type="button" class="story__quit">離開</button>
      </div>
      <div class="story__body" id="story-body"></div>
      <div class="story__foot" id="story-foot"></div>`;
    this.mount.appendChild(this.el);
    this.body = this.el.querySelector('#story-body');
    this.foot = this.el.querySelector('#story-foot');
    this.sceneEl = this.el.querySelector('#story-scene');

    this.el.querySelector('.story__quit').addEventListener('click', () => {
      this.onSave?.(this.ctx);
      this.onQuit?.();
    });
    this.body.addEventListener('click', () => { if (this.phase === 'lines') this._step(); });

    this._enterNode();
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  // ── 節點流程 ────────────────────────────────────────────
  _enterNode() {
    const { node, dialogue, choices } = presentNode(this.story, this.ctx, this.nodes);
    this.node = node;
    this.choices = choices;
    if (node.scene) {
      const bits = [node.scene.location, node.scene.time].filter(Boolean);
      this.sceneEl.innerHTML = `<b>${esc(bits[0] ?? '')}</b>${bits[1] ? ' ・ ' + esc(bits[1]) : ''}`;
    }
    this.queue = [...dialogue];
    this.phase = 'lines';
    this.foot.replaceChildren();
    this._step();
  }

  _step() {
    if (this.queue.length) this._render(this.queue.shift());
    // 還有下一句就留著「繼續」鍵：點畫面任何地方也可以，但按鍵要看得到
    if (this.queue.length) this._continue('繼續', () => this._step());
    else this._showActions();
  }

  _continue(label, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = label;
    btn.addEventListener('click', fn);
    this.foot.replaceChildren(btn);
  }

  _showActions() {
    this.foot.replaceChildren();
    if (this.node.node_type === 'decision') {
      this.phase = 'choices';
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
    this.phase = 'lines';
    this._continue('繼續', () => this._advance());
  }

  _choose(choiceId) {
    const result = choose(this.story, this.ctx, choiceId, this.nodes);
    this.onSave?.(this.ctx);
    this.foot.replaceChildren();
    this.queue = [...result.immediate];
    this.pendingClue = result.clue;
    this.phase = 'lines';
    this._flushImmediate();
  }

  /** 選擇後的立即反應播完，才顯示心聲線索。 */
  _flushImmediate() {
    if (this.queue.length) {
      this._render(this.queue.shift());
      this._continue('繼續', () => this._flushImmediate());
      return;
    }
    if (this.pendingClue) {
      const clue = document.createElement('div');
      clue.className = 'clue';
      clue.innerHTML = `<div class="clue__title">${esc(this.pendingClue.title)}</div>
        <div class="clue__text">${esc(this.pendingClue.text)}</div>`;
      this.body.appendChild(clue);
      this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
      this.pendingClue = null;
      this._continue('繼續', () => this._enterNode());
      return;
    }
    this._enterNode();
  }

  _advance() {
    const step = advance(this.story, this.ctx, this.nodes);
    this.onSave?.(this.ctx);
    if (step?.kind === 'ending') {
      this._renderEnding(step);
      return;
    }
    this.body.replaceChildren();
    this._enterNode();
  }

  _renderEnding(step) {
    this.body.replaceChildren();
    this.sceneEl.innerHTML = `<b>結局</b> ・ ${esc(step.ending.title)}`;
    this.queue = [...step.ending.dialogue];
    this.phase = 'lines';
    const next = () => {
      if (this.queue.length) {
        this._render(this.queue.shift());
        this._continue(this.queue.length ? '繼續' : '看看這一趟走了什麼', next);
        return;
      }
      this.onFinish?.({
        recap: buildRecap(this.story, this.ctx),
        ending: step.ending,
        route: step.route,
        story: this.story,
        ctx: this.ctx,
      });
    };
    next();
  }

  // ── 單句渲染 ────────────────────────────────────────────
  _render(line) {
    const p = document.createElement('p');
    const style = line.style ?? 'narration';
    p.className = `line line--${style}`;
    const who = this.names[line.speaker];
    if (style === 'line' || style === 'message') {
      p.innerHTML = `<span class="line__who">${esc(who ?? line.speaker)}</span>
        <span class="line__text">${esc(line.text)}</span>`;
    } else {
      p.textContent = line.text;
    }
    this.body.appendChild(p);
    this.body.scrollTo({ top: this.body.scrollHeight, behavior: 'smooth' });
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
    return wrap;
  }
}
