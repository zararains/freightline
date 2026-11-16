// hud.js — DOM HUD. Design: all in-game readouts live in one overlay layer
// updated from game state each frame; menus are separate panels toggled by
// the main loop so staged screenshots can pose any of them.
export class HUD {
  constructor(root) {
    this.el = {};
    const ids = ['hud', 'hp', 'armor', 'money', 'ammo', 'weaponName', 'timer', 'scoreAtk', 'scoreDef',
      'roundLabel', 'killfeed', 'crosshair', 'hitmarker', 'dmgDir', 'banner', 'bannerTitle', 'bannerSub',
      'menu', 'buyMenu', 'buyGrid', 'buyMoney', 'scoreboard', 'sbBody', 'interact', 'interactBar',
      'bombWarn', 'scope', 'flash', 'scopeHint', 'minimap', 'teamAlive', 'grenades', 'matchEnd',
      'matchTitle', 'matchSub', 'plantedTimer', 'centerMsg', 'helpLine'];
    for (const id of ids) this.el[id] = root.querySelector('#' + id);
    this.feed = [];
  }
  show(id, on) { if (this.el[id]) this.el[id].style.display = on ? '' : 'none'; }
  setCrosshairSpread(px) {
    const c = this.el.crosshair; if (!c) return;
    c.style.setProperty('--sp', px.toFixed(0) + 'px');
  }
  hitmark(head) {
    const h = this.el.hitmarker; if (!h) return;
    h.style.opacity = '1'; h.style.color = head ? '#ffcf4d' : '#ffffff';
    clearTimeout(this._hmT); this._hmT = setTimeout(() => { h.style.opacity = '0'; }, 130);
  }
  damageFrom(angleDeg) {
    const d = this.el.dmgDir; if (!d) return;
    d.style.opacity = '1';
    d.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
    clearTimeout(this._dmgT); this._dmgT = setTimeout(() => { d.style.opacity = '0'; }, 650);
  }
  addFeed(text, color = '#fff') {
    this.feed.unshift({ text, color, at: performance.now() });
    this.feed = this.feed.slice(0, 5);
    this.el.killfeed.innerHTML = this.feed.map(f =>
      `<div style="color:${f.color}">${f.text}</div>`).join('');
  }
  banner(title, sub, ms = 2600) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.show('banner', true);
    clearTimeout(this._bT);
    if (ms > 0) this._bT = setTimeout(() => this.show('banner', false), ms);
  }
  centerMsg(text, ms = 1600) {
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.style.opacity = '1';
    clearTimeout(this._cT);
    this._cT = setTimeout(() => { this.el.centerMsg.style.opacity = '0'; }, ms);
  }
  interact(label, frac) {
    // Callers hide the prompt with interact(null) — a missing frac must hide
    // too, otherwise the empty bar lingers on screen (found in shot testing).
    if (frac === null || frac === undefined) { this.show('interact', false); return; }
    this.show('interact', true);
    this.el.interact.querySelector('.ilabel').textContent = label;
    this.el.interactBar.style.width = (frac * 100).toFixed(1) + '%';
  }
  renderScoreboard(rows) {
    this.el.sbBody.innerHTML = rows.map(r =>
      `<tr class="${r.me ? 'me' : ''}"><td>${r.name}</td><td>${r.team}</td><td>${r.k}</td><td>${r.d}</td><td>$${r.money}</td><td>${r.alive ? 'alive' : 'down'}</td></tr>`).join('');
  }
  flashScreen(alpha) {
    this.el.flash.style.opacity = String(Math.min(1, alpha));
  }
}
