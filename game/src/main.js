// main.js — FREIGHTLINE game orchestration.
// Owns the round state machine (menu → buy → play → planted → round end →
// match end), player movement, shared hitscan resolution for the player and
// all nine bots, the breach-charge logic, economy and the staged scenes the
// screenshot kit captures.
import * as THREE from 'three';
import { buildWorld, collide, groundHeightAt, rayHitAABB, SITE_A, SITE_B, SPAWN_ATK, SPAWN_DEF } from './world.js';
import { WEAPONS, WeaponInstance, falloffDamage, ARMOR_PRICE, FRAG_PRICE, SMOKE_PRICE, KIT_PRICE } from './weapons.js';
import { Bot, ATK_NAMES, DEF_NAMES } from './bots.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
let seed = parseInt(params.get('seed') || '1', 10) || 1;
// Small deterministic RNG so staged scenes pose identically every load.
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry(seed * 7919 + 13);

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 500);
const world = buildWorld(scene);
const hud = new HUD(document);
const audio = new AudioEngine();

// ---------- viewmodel ----------
const viewGun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc9862b, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark); viewGun.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), dark); barrel.position.set(0, 0.03, -0.38); viewGun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.09), accent); grip.position.set(0, -0.14, 0.08); grip.rotation.x = 0.3; viewGun.add(grip);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), dark); mag.position.set(0, -0.13, -0.08); viewGun.add(mag);
  // Revision after screenshot review: the first-pass viewmodel read as one
  // dark slab. A raised rear sight, a slimmer receiver and a slight inward
  // cant make it read as a rifle at a glance.
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.1), accent); sight.position.set(0, 0.1, 0.02); viewGun.add(sight);
  viewGun.scale.setScalar(0.82);
  viewGun.rotation.y = 0.06;
  viewGun.position.set(0.24, -0.22, -0.45);
  camera.add(viewGun);
  scene.add(camera);
}
const muzzle = new THREE.PointLight(0xffb45e, 0, 9); scene.add(muzzle);

// ---------- effects ----------
const effects = []; // {obj, until, kind, vel?}
const tracerMat = () => new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
function tracer(from, to, life = 0.07) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat());
  scene.add(line);
  effects.push({ obj: line, until: perfNow() + life, kind: 'fade' });
}
function impactFX(p, n = 6, color = 0xd8c9a8) {
  const geo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(p.x, p.y, p.z);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.14, transparent: true });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  const vels = [];
  for (let i = 0; i < n; i++) vels.push(new THREE.Vector3((rng() - 0.5) * 2.4, rng() * 2.2, (rng() - 0.5) * 2.4));
  effects.push({ obj: points, until: perfNow() + 0.45, kind: 'burst', vels });
}
function perfNow() { return performance.now() / 1000; }

// ---------- player ----------
const player = {
  isPlayer: true, name: 'You', team: 'atk',
  pos: new THREE.Vector3(SPAWN_ATK.x, 0, SPAWN_ATK.z),
  velY: 0, yaw: Math.PI, pitch: 0, onGround: true,
  hp: 100, armorPts: 0, alive: true,
  money: 800, kills: 0, deaths: 0,
  primary: null, sidearm: new WeaponInstance(WEAPONS.pistol),
  current: null, frag: 0, smoke: 0, hasKit: false, hasBomb: false,
  crouch: false, scoped: false, stepAt: 0,
  eyeY() { return this.pos.y + (this.crouch ? 1.18 : 1.62); },
};
player.current = player.sidearm;
const keys = {};
let mouseDown = false, rmbDown = false;

// ---------- bots ----------
const bots = [];
{
  let i = 0;
  for (const n of ATK_NAMES) { const b = new Bot(n, 'atk', world, i++); bots.push(b); scene.add(b.mesh); }
  for (const n of DEF_NAMES) { const b = new Bot(n, 'def', world, i++); bots.push(b); scene.add(b.mesh); }
}
const allFighters = () => [player, ...bots];

// ---------- bomb ----------
const bombMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26),
  new THREE.MeshStandardMaterial({ color: 0x8a2f22, roughness: 0.5 }));
const bombLight = new THREE.PointLight(0xff3b2f, 0, 6);
bombMesh.visible = false; scene.add(bombMesh); scene.add(bombLight);
const bomb = { state: 'carried', carrier: null, pos: new THREE.Vector3(), site: null, fuseAt: 0, beepAt: 0 };

// ---------- grenades & smoke ----------
const grenades = []; // {mesh, vel, kind, explodeAt}
const smokes = [];   // {pos, until, mesh, box}
function throwGrenade(owner, kind) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: kind === 'frag' ? 0x4a5d23 : 0x888888, roughness: 0.6 }));
  const eye = new THREE.Vector3(owner.pos.x, owner.eyeY(), owner.pos.z);
  const dir = owner === player ? cameraDir() : new THREE.Vector3(-Math.sin(owner.yaw), 0.25, -Math.cos(owner.yaw)).normalize();
  mesh.position.copy(eye).addScaledVector(dir, 0.5);
  scene.add(mesh);
  grenades.push({ mesh, vel: dir.clone().multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0)), kind, owner, explodeAt: perfNow() + 1.5 });
}

// ---------- match state ----------
const G = {
  phase: 'menu', // menu | buy | play | planted | roundEnd | matchEnd
  round: 1, scoreAtk: 0, scoreDef: 0,
  phaseAt: 0, timeLeft: 0, targetSite: SITE_A,
  plantProgress: 0, defuseProgress: 0, planter: null, defuser: null,
  lossStreak: 0, staged: !!SHOT, over: false,
};
const WIN_SCORE = 9;

function cameraDir() {
  const d = new THREE.Vector3(0, 0, -1);
  d.applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  return d;
}
function fighterEye(f) { return new THREE.Vector3(f.pos.x, f.eyeY(), f.pos.z); }

function livingTeam(team) { return allFighters().filter(f => f.team === team && f.alive); }

function assignSpawns() {
  const spread = (base, i) => ({ x: base.x + (i % 3 - 1) * 3.2, z: base.z + Math.floor(i / 3) * 2.6 });
  player.pos.set(SPAWN_ATK.x - 3, 0, SPAWN_ATK.z); player.yaw = Math.PI; player.pitch = 0;
  player.velY = 0;
  let ai = 0, di = 0;
  for (const b of bots) {
    if (b.team === 'atk') { const s = spread(SPAWN_ATK, ai++); b.resetForRound(s, Math.PI); }
    else { const s = spread(SPAWN_DEF, di++); b.resetForRound(s, 0); }
  }
}

function startRound() {
  G.phase = 'buy'; G.phaseAt = perfNow(); G.timeLeft = 12;
  G.plantProgress = 0; G.defuseProgress = 0; G.planter = null; G.defuser = null;
  G.targetSite = rng() < 0.5 ? SITE_A : SITE_B;
  for (const g of grenades) scene.remove(g.mesh); grenades.length = 0;
  for (const s of smokes) scene.remove(s.mesh); smokes.length = 0;
  for (const f of allFighters()) {
    f.hp = 100; f.alive = true;
    if (f.isPlayer) {
      player.armorPts = player.armorPts > 0 ? player.armorPts : 0;
      if (!player.primary && player.sidearm.ammo < 4) player.sidearm = new WeaponInstance(WEAPONS.pistol);
      player.current = player.primary || player.sidearm;
      player.hasBomb = false;
    } else { f.buyRound(rng); f.hasBomb = false; }
  }
  assignSpawns();
  // Bomb goes to a random living attacker each round.
  const atks = [player, ...bots.filter(b => b.team === 'atk')];
  const carrier = atks[Math.floor(rng() * atks.length)];
  carrier.hasBomb = true; bomb.state = 'carried'; bomb.carrier = carrier; bomb.site = null;
  bombMesh.visible = false;
  hud.show('bombWarn', false);
  hud.el.roundLabel.textContent = `Round ${G.round} — ${G.targetSite === SITE_A ? 'intel: A quiet' : 'intel: B quiet'}`;
  openBuy();
  hud.centerMsg(carrier === player ? 'You carry the breach charge' : `${carrier.name} carries the charge`, 2200);
}

function endRound(winner, reason) {
  if (G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
  G.phase = 'roundEnd'; G.phaseAt = perfNow();
  document.exitPointerLock?.();
  if (winner === 'atk') G.scoreAtk++; else G.scoreDef++;
  // Economy: winners paid, losers get a growing loss bonus, planter bonus.
  const winPay = 2500, plantTeamPay = 800;
  for (const f of allFighters()) {
    if (f.team === winner) { f.money += winPay; G.lossStreak = 0; }
    else f.money += 1400;
    if (bomb.site && f.team === 'atk') f.money += plantTeamPay;
    if (bomb.planterRef === f) f.money += 300;
    f.money = Math.min(16000, f.money);
  }
  const title = winner === player.team ? 'ROUND WON' : 'ROUND LOST';
  hud.banner(title, reason, 2800);
  if (winner === player.team) audio.roundWin(); else audio.roundLose();
  if (G.scoreAtk >= WIN_SCORE || G.scoreDef >= WIN_SCORE) {
    setTimeout(() => {
      G.phase = 'matchEnd'; G.over = true;
      const won = (G.scoreAtk > G.scoreDef) === (player.team === 'atk');
      hud.el.matchTitle.textContent = won ? 'VICTORY — YARD SECURED' : 'DEFEAT — YARD LOST';
      hud.el.matchSub.textContent = `Final score ${G.scoreAtk} : ${G.scoreDef}. Your line: ${player.kills} kills, ${player.deaths} deaths.`;
      hud.show('matchEnd', true); hud.show('hud', false);
      if (won) audio.matchWin();
    }, 2900);
  }
}

function explodeBomb() {
  audio.explosion();
  const p = bomb.pos.clone(); p.y = 1;
  impactFX(p, 42, 0xff8a3c); impactFX(p, 30, 0xffcf4d);
  muzzle.intensity = 60; muzzle.position.copy(p);
  for (const f of allFighters()) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - bomb.pos.x, f.pos.z - bomb.pos.z);
    if (d < 11) applyDamage(f, Math.round(120 * (1 - d / 13)), false, null, true);
  }
  bombMesh.visible = false; bombLight.intensity = 0;
  endRound('atk', 'Charge detonated at ' + (bomb.site === SITE_A ? 'Site A' : 'Site B'));
}

// ---------- damage & shooting ----------
function applyDamage(target, dmg, isHead, attacker, isBlast = false) {
  if (!target.alive || G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
  let final = dmg;
  // Armor absorbs just under half the damage while it has points left.
  const armored = target.isPlayer ? target.armorPts > 0 : target.armor;
  if (armored && !isBlast) {
    const absorbed = Math.round(final * 0.45);
    final -= absorbed;
    if (target.isPlayer) target.armorPts = Math.max(0, target.armorPts - absorbed);
  }
  target.hp -= final;
  if (target.isPlayer) {
    audio.hurt();
    if (attacker) {
      const ang = Math.atan2(attacker.pos.x - target.pos.x, attacker.pos.z - target.pos.z);
      hud.damageFrom(THREE.MathUtils.radToDeg(ang - target.yaw + Math.PI));
    }
  }
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false; target.deaths++;
    if (!target.isPlayer) target.mesh.visible = false;
    if (attacker) {
      attacker.kills++; attacker.money = Math.min(16000, attacker.money + 300);
      hud.addFeed(`${attacker.name} ▸ ${target.name}${isHead ? ' (headshot)' : ''}`, attacker.team === 'atk' ? '#ffa04d' : '#7db8ff');
      if (attacker.isPlayer) { hud.hitmark(true); audio.headshotTick(); }
    } else hud.addFeed(`${target.name} was caught in the blast`, '#ffb0a0');
    if (target.hasBomb && bomb.state === 'carried') {
      target.hasBomb = false; bomb.state = 'dropped'; bomb.carrier = null;
      bomb.pos.set(target.pos.x, 0, target.pos.z);
      bombMesh.position.set(bomb.pos.x, 0.15, bomb.pos.z); bombMesh.visible = true;
    }
    checkElimination();
  }
}
function checkElimination() {
  if (G.phase !== 'play' && G.phase !== 'planted') return;
  if (livingTeam('atk').length === 0 && G.phase !== 'planted') endRound('def', 'Attackers eliminated');
  else if (livingTeam('atk').length === 0 && G.phase === 'planted') { /* charge still ticks */ }
  else if (livingTeam('def').length === 0) endRound('atk', 'Defenders eliminated');
}

// Ray vs fighter: head sphere + torso sphere. Returns {f, t, head} or null.
function rayFighter(o, d, f, maxT) {
  let best = null;
  const spheres = [
    { c: new THREE.Vector3(f.pos.x, f.pos.y + 1.66, f.pos.z), r: 0.24, head: true },
    { c: new THREE.Vector3(f.pos.x, f.pos.y + 1.0, f.pos.z), r: 0.52, head: false },
  ];
  for (const s of spheres) {
    const oc = o.clone().sub(s.c);
    const b = oc.dot(d), c = oc.dot(oc) - s.r * s.r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < maxT && (!best || t < best.t)) best = { f, t, head: s.head };
  }
  return best;
}

function fireHitscan(shooter, origin, dir, wInst) {
  const def = wInst.def;
  const maxT = def.range;
  let wallT = maxT;
  for (const c of world.colliders) {
    const t = rayHitAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c, wallT);
    if (t !== null && t < wallT) wallT = t;
  }
  if (dir.y < -0.001) { const tg = -origin.y / dir.y; if (tg > 0 && tg < wallT) wallT = tg; }
  let hit = null;
  for (const f of allFighters()) {
    if (f === shooter || !f.alive || f.team === shooter.team) continue;
    const h = rayFighter(origin, dir, f, wallT);
    if (h && (!hit || h.t < hit.t)) hit = h;
  }
  const endT = hit ? hit.t : wallT;
  const end = origin.clone().addScaledVector(dir, endT);
  tracer(origin.clone().addScaledVector(dir, 0.6), end, shooter.isPlayer ? 0.06 : 0.08);
  if (hit) {
    const dmg = Math.round(falloffDamage(def, hit.t) * (hit.head ? def.headMult : 1));
    impactFX(end, hit.head ? 8 : 5, 0xff6a4d);
    applyDamage(hit.f, dmg, hit.head, shooter);
    if (shooter.isPlayer) { hud.hitmark(hit.head); if (hit.head) audio.headshotTick(); else audio.hitTick(); }
    return true;
  }
  impactFX(end, 4);
  return false;
}

function spreadDir(base, spread) {
  const d = base.clone();
  d.x += (rng() - 0.5) * 2 * spread; d.y += (rng() - 0.5) * 2 * spread; d.z += (rng() - 0.5) * 2 * spread;
  return d.normalize();
}

// ---------- buy menu ----------
const BUY_ITEMS = [
  { key: '1', label: 'VK-9 SMG', sub: 'Fast fire, close range — $1,250', price: 1250, act: () => { player.primary = new WeaponInstance(WEAPONS.smg); player.current = player.primary; }, owned: () => player.primary?.def.id === 'smg' },
  { key: '2', label: 'AR-47 Rifle', sub: 'All-round workhorse — $2,700', price: 2700, act: () => { player.primary = new WeaponInstance(WEAPONS.rifle); player.current = player.primary; }, owned: () => player.primary?.def.id === 'rifle' },
  { key: '3', label: 'Longshot .50 Sniper', sub: 'Scoped, one-shot power — $4,500', price: 4500, act: () => { player.primary = new WeaponInstance(WEAPONS.sniper); player.current = player.primary; }, owned: () => player.primary?.def.id === 'sniper' },
  { key: '4', label: 'Kevlar Vest', sub: 'Cuts bullet damage — $650', price: ARMOR_PRICE, act: () => { player.armorPts = 100; }, owned: () => player.armorPts > 0 },
  { key: '5', label: 'Frag Grenade', sub: 'Area damage — $300', price: FRAG_PRICE, act: () => { player.frag = 1; }, owned: () => player.frag > 0 },
  { key: '6', label: 'Smoke Grenade', sub: 'Blocks sight lines — $300', price: SMOKE_PRICE, act: () => { player.smoke = 1; }, owned: () => player.smoke > 0 },
];
let buyOpen = false;
function renderBuy() {
  hud.el.buyMoney.textContent = '$' + player.money;
  hud.el.buyGrid.innerHTML = '';
  for (const item of BUY_ITEMS) {
    const div = document.createElement('div');
    div.className = 'buyItem' + (item.owned() ? ' owned' : '');
    div.innerHTML = `<b>[${item.key}] ${item.label}</b><small>${item.sub}${item.owned() ? ' · OWNED' : ''}</small>`;
    div.onclick = () => buyItem(item);
    hud.el.buyGrid.appendChild(div);
  }
}
function buyItem(item) {
  if (item.owned()) { audio.deny(); return; }
  if (player.money < item.price) { audio.deny(); hud.centerMsg('Not enough funds', 900); return; }
  player.money -= item.price; item.act(); audio.buy(); renderBuy();
}
function openBuy() { if (G.staged && SHOT !== 'start' && SHOT !== 'buy') return; buyOpen = true; renderBuy(); hud.show('buyMenu', true); }
function closeBuy() { buyOpen = false; hud.show('buyMenu', false); }

// ---------- input ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(true); }
  if (buyOpen && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].includes(e.code)) {
    buyItem(BUY_ITEMS[parseInt(e.code.slice(-1), 10) - 1]); return;
  }
  if (e.code === 'KeyB') { if (G.phase === 'buy') { buyOpen ? closeBuy() : openBuy(); } }
  if (e.code === 'Escape' && buyOpen) closeBuy();
  if (e.code === 'Digit1' && player.primary) { player.current = player.primary; player.scoped = false; }
  if (e.code === 'Digit2') { player.current = player.sidearm; player.scoped = false; }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG' && player.alive && player.frag > 0 && (G.phase === 'play' || G.phase === 'planted')) { player.frag--; throwGrenade(player, 'frag'); }
  if (e.code === 'KeyV' && player.alive && player.smoke > 0 && (G.phase === 'play' || G.phase === 'planted')) { player.smoke--; throwGrenade(player, 'smoke'); }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') showScoreboard(false);
});
function showScoreboard(on) {
  if (!on) { hud.show('scoreboard', false); return; }
  const rows = allFighters().map(f => ({ name: f.name, team: f.team.toUpperCase(), k: f.kills, d: f.deaths, money: f.money, alive: f.alive, me: !!f.isPlayer }))
    .sort((a, b) => b.k - a.k);
  hud.renderScoreboard(rows);
  hud.show('scoreboard', true);
}
renderer.domElement.addEventListener('mousedown', e => {
  audio.ensure();
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) rmbDown = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) rmbDown = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement || !player.alive) return;
  const sens = player.scoped ? 0.0009 : 0.0023;
  player.yaw -= e.movementX * sens;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * sens, -1.45, 1.45);
});
renderer.domElement.addEventListener('click', () => {
  audio.ensure();
  if (!G.staged && (G.phase === 'play' || G.phase === 'planted' || G.phase === 'buy') && document.pointerLockElement !== renderer.domElement && !buyOpen)
    renderer.domElement.requestPointerLock();
});
document.getElementById('playBtn').onclick = () => {
  audio.ensure();
  hud.show('menu', false); hud.show('hud', true);
  G.round = 1; G.scoreAtk = 0; G.scoreDef = 0;
  startRound();
  renderer.domElement.requestPointerLock();
};
document.getElementById('againBtn').onclick = () => location.reload();

function startReload() {
  const w = player.current, now = perfNow();
  if (!w || w.ammo >= w.def.mag || w.reserve <= 0 || now < w.reloadingUntil) return;
  w.reloadingUntil = now + w.def.reloadTime;
  audio.reload();
  setTimeout(() => {
    const take = Math.min(w.def.mag - w.ammo, w.reserve);
    w.ammo += take; w.reserve -= take;
  }, w.def.reloadTime * 1000);
}

// ---------- player update ----------
let lastShotAt = 0;
function updatePlayer(dt, now) {
  if (!player.alive) { viewGun.visible = false; return; }
  viewGun.visible = true;
  const inBuy = G.phase === 'buy';
  player.crouch = !!(keys['ControlLeft'] || keys['KeyC'] && false || keys['ControlRight']);
  const sprint = keys['ShiftLeft'] && !player.crouch && !player.scoped;
  const speed = 5.1 * (sprint ? 1.42 : 1) * (player.crouch ? 0.5 : 1) * (player.scoped ? 0.55 : 1) * player.current.def.moveSpeed;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let mx = 0, mz = 0;
  if (!inBuy || G.staged) {
    if (keys['KeyW']) { mx += -sin; mz += -cos; }
    if (keys['KeyS']) { mx += sin; mz += cos; }
    if (keys['KeyA']) { mx += -cos; mz += sin; }
    if (keys['KeyD']) { mx += cos; mz += -sin; }
  }
  const len = Math.hypot(mx, mz);
  const moving = len > 0.01;
  if (moving) {
    mx /= len; mz /= len;
    player.pos.x += mx * speed * dt; player.pos.z += mz * speed * dt;
    if (player.onGround && now > player.stepAt) { audio.footstep(sprint); player.stepAt = now + (sprint ? 0.3 : 0.42); }
  }
  const gh = groundHeightAt(player.pos.x, player.pos.z, world.colliders);
  if ((keys['Space']) && player.onGround && !inBuy) { player.velY = 5.4; player.onGround = false; audio.jump(); }
  player.velY -= 15.5 * dt;
  player.pos.y += player.velY * dt;
  const floorY = Math.max(0, gh);
  if (player.pos.y <= floorY) { player.pos.y = floorY; player.velY = 0; player.onGround = true; }
  collide(player.pos, 0.45, world.colliders, player.pos.y);
  // Camera + recoil recovery.
  player.current.bloom = Math.max(0, player.current.bloom - dt * 0.05);
  camera.position.set(player.pos.x, player.eyeY(), player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  viewGun.position.y = -0.22 + Math.sin(now * (moving ? 9 : 2)) * (moving ? 0.012 : 0.003);
  // Scoping.
  const wantScope = rmbDown && player.current.def.id === 'sniper';
  player.scoped = wantScope;
  camera.fov = THREE.MathUtils.lerp(camera.fov, wantScope ? 26 : 78, 0.35);
  camera.updateProjectionMatrix();
  hud.show('scope', wantScope);
  viewGun.visible = !wantScope;
  // Bomb pickup from ground.
  if (bomb.state === 'dropped' && player.team === 'atk' && Math.hypot(player.pos.x - bomb.pos.x, player.pos.z - bomb.pos.z) < 1.6) {
    bomb.state = 'carried'; bomb.carrier = player; player.hasBomb = true; bombMesh.visible = false;
    hud.centerMsg('Charge recovered', 1200);
  }
  // Shooting.
  const w = player.current;
  const canShoot = (G.phase === 'play' || G.phase === 'planted') && !buyOpen;
  if (mouseDown && canShoot && now >= w.reloadingUntil) {
    if (now - lastShotAt >= w.interval() && (w.def.auto || !updatePlayer._latched)) {
      updatePlayer._latched = true;
      if (w.ammo <= 0) { audio.dryFire(); lastShotAt = now; }
      else {
        w.ammo--; lastShotAt = now;
        w.bloom = Math.min(0.05, w.bloom + w.def.spreadBloom);
        const spread = w.def.spreadBase + (moving ? w.def.spreadMove : 0) + w.bloom + (player.crouch ? -0.004 : 0.004);
        const dir = spreadDir(cameraDir(), Math.max(0.001, spread));
        fireHitscan(player, fighterEye(player), dir, w);
        audio.shot(w.def.id);
        player.pitch += w.def.recoil * (0.7 + rng() * 0.6);
        muzzle.intensity = 14; muzzle.position.copy(fighterEye(player)).addScaledVector(dir, 1.1);
      }
    }
  }
  if (!mouseDown) updatePlayer._latched = false;
  // Planting by the player.
  let interacting = false;
  if (keys['KeyE'] && player.hasBomb && G.phase === 'play') {
    const inA = Math.hypot(player.pos.x - SITE_A.x, player.pos.z - SITE_A.z) < SITE_A.r;
    const inB = Math.hypot(player.pos.x - SITE_B.x, player.pos.z - SITE_B.z) < SITE_B.r;
    if (inA || inB) {
      interacting = true;
      G.plantProgress += dt / 3.5;
      if (Math.floor(G.plantProgress * 8) !== Math.floor((G.plantProgress - dt / 3.5) * 8)) audio.plantBeep(false);
      hud.interact('Planting breach charge…', Math.min(1, G.plantProgress));
      if (G.plantProgress >= 1) completePlant(player, inA ? SITE_A : SITE_B);
    }
  }
  if (!interacting) { if (G.phase === 'play') G.plantProgress = Math.max(0, G.plantProgress - dt * 1.5); if (!G._botInteracting && !G.staged) hud.interact(null); }
  // HUD numbers.
  hud.el.hp.textContent = Math.ceil(player.hp);
  document.getElementById('hpBar').style.width = Math.max(0, player.hp) + '%';
  hud.el.armor.textContent = Math.round(player.armorPts);
  document.getElementById('armorFill').style.width = player.armorPts + '%';
  hud.el.money.textContent = '$' + player.money;
  hud.el.ammo.textContent = `${w.ammo} / ${w.reserve}`;
  hud.el.weaponName.textContent = w.def.name + (player.hasBomb ? ' · CARRYING CHARGE' : '');
  hud.el.grenades.textContent = `Frag ×${player.frag} · Smoke ×${player.smoke}`;
  hud.el.teamAlive.textContent = `ATK alive ${livingTeam('atk').length} · DEF alive ${livingTeam('def').length}`;
  const spreadPx = 6 + (w.def.spreadBase + w.bloom + (moving ? w.def.spreadMove : 0)) * 900;
  hud.setCrosshairSpread(spreadPx);
}

function completePlant(planter, site) {
  planter.hasBomb = false;
  bomb.state = 'planted'; bomb.site = site; bomb.planterRef = planter;
  bomb.pos.set(planter.pos.x, 0, planter.pos.z);
  bombMesh.position.set(bomb.pos.x, 0.15, bomb.pos.z); bombMesh.visible = true;
  G.phase = 'planted'; G.phaseAt = perfNow(); G.timeLeft = 40;
  G.plantProgress = 0;
  audio.plantDone();
  hud.show('bombWarn', true);
  hud.centerMsg(`Charge planted at ${site === SITE_A ? 'Site A' : 'Site B'}`, 2000);
  hud.interact(null);
}
function completeDefuse(defuser) {
  bomb.state = 'defused'; bombMesh.visible = false; bombLight.intensity = 0;
  hud.show('bombWarn', false);
  endRound('def', `Charge defused by ${defuser.name}`);
}

// ---------- bot orchestration ----------
function botCtx() {
  const dynColliders = world.colliders.concat(smokes.map(s => s.box));
  return {
    enemies: [], colliders: dynColliders, phase: G.phase,
    atMySite: b => Math.hypot(b.pos.x - G.targetSite.x, b.pos.z - G.targetSite.z) < G.targetSite.r,
    nearBomb: (b, d) => Math.hypot(b.pos.x - bomb.pos.x, b.pos.z - bomb.pos.z) < d,
    objectiveFor: b => {
      if (G.phase === 'planted') {
        if (b.team === 'def') return { x: bomb.pos.x, z: bomb.pos.z };
        return { x: bomb.pos.x + (b.spawnIdx - 2) * 4, z: bomb.pos.z + 9 };
      }
      if (b.team === 'atk') {
        if (b.hasBomb) return { x: G.targetSite.x, z: G.targetSite.z };
        // Teammates escort toward the same site, spread slightly.
        return { x: G.targetSite.x + (b.spawnIdx - 2) * 3.5, z: G.targetSite.z + 7 + (b.spawnIdx % 2) * 3 };
      }
      // Defenders split across both sites, then rotate to the plant.
      const site = b.spawnIdx % 2 === 0 ? SITE_A : SITE_B;
      return { x: site.x + (b.spawnIdx - 2) * 2.5, z: site.z + 5 };
    },
  };
}
function updateBots(dt, now) {
  if (G.phase === 'buy' || G.phase === 'roundEnd' || G.phase === 'matchEnd' || G.phase === 'menu') return;
  G._botInteracting = false;
  for (const b of bots) {
    const ctx = botCtx();
    ctx.enemies = allFighters().filter(f => f.team !== b.team);
    const events = b.update(dt, now, ctx);
    for (const ev of events) {
      if (ev.type === 'shoot') {
        const w = b.weapon();
        const tp = ev.target;
        const targetPos = new THREE.Vector3(tp.pos.x, tp.pos.y + (rng() < 0.28 ? 1.66 : 1.05), tp.pos.z);
        const origin = fighterEye(b);
        const dir = targetPos.sub(origin).normalize();
        const dist = Math.hypot(tp.pos.x - b.pos.x, tp.pos.z - b.pos.z);
        const inSmoke = smokes.some(s => Math.hypot(tp.pos.x - s.pos.x, tp.pos.z - s.pos.z) < 4.5);
        const spread = (0.028 + dist * 0.0006) / b.skill * (inSmoke ? 2.2 : 1);
        fireHitscan(b, origin, spreadDir(dir, spread), w);
        audio.shot(w.def.id);
      } else if (ev.type === 'plantHold' && b.hasBomb) {
        G._botInteracting = true;
        G.plantProgress += dt / 3.5;
        if (b === bots[0] || true) { /* progress shown only to the planter's team via center feed */ }
        if (G.plantProgress >= 1) completePlant(b, G.targetSite);
      } else if (ev.type === 'defuseHold') {
        const need = b.hasKit ? 3.5 : 7;
        G.defuseProgress += dt / need;
        if (Math.random() < dt * 3) audio.defuseTick();
        if (G.defuseProgress >= 1) completeDefuse(b);
      }
    }
    // Dropped-bomb pickup for bots.
    if (bomb.state === 'dropped' && b.team === 'atk' && b.alive && Math.hypot(b.pos.x - bomb.pos.x, b.pos.z - bomb.pos.z) < 1.6) {
      bomb.state = 'carried'; bomb.carrier = b; b.hasBomb = true; bombMesh.visible = false;
    }
  }
  if (G.phase === 'play' && !keys['KeyE']) G.plantProgress = Math.max(0, G.plantProgress - dt * 0.8);
  if (G.phase === 'planted') G.defuseProgress = Math.max(0, G.defuseProgress - dt * 0.6);
}

// ---------- grenades / smoke update ----------
function updateGrenades(dt, now) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vel.y -= 16 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.12) { g.mesh.position.y = 0.12; g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    collide(g.mesh.position, 0.12, world.colliders, 0);
    if (now >= g.explodeAt) {
      const p = g.mesh.position.clone();
      scene.remove(g.mesh); grenades.splice(i, 1);
      if (g.kind === 'frag') {
        audio.grenadeBoom(); impactFX(p, 22, 0xff8a3c);
        for (const f of allFighters()) {
          if (!f.alive || f === g.owner) continue;
          const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
          if (d < 7.5) applyDamage(f, Math.round(85 * (1 - d / 8.5)), false, g.owner, true);
        }
      } else {
        // Smoke: a soft cloud plus a temporary LOS box bots cannot see through.
        const cloud = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 10),
          new THREE.MeshStandardMaterial({ color: 0xcfd4d8, transparent: true, opacity: 0.55, roughness: 1 }));
        cloud.position.set(p.x, 1.6, p.z); scene.add(cloud);
        smokes.push({ pos: cloud.position, mesh: cloud, until: now + 13, box: { minX: p.x - 4, maxX: p.x + 4, minZ: p.z - 4, maxZ: p.z + 4, h: 3.4 } });
        audio.noise(0.5, 1200, 0.2, 'bandpass');
      }
    }
  }
  for (let i = smokes.length - 1; i >= 0; i--) if (now > smokes[i].until) { scene.remove(smokes[i].mesh); smokes.splice(i, 1); }
}

// ---------- round timer ----------
function updateTimers(dt, now) {
  hud.el.scoreAtk.textContent = G.scoreAtk;
  hud.el.scoreDef.textContent = G.scoreDef;
  if (G.phase === 'buy') {
    G.timeLeft -= dt;
    hud.el.timer.textContent = 'BUY ' + Math.max(0, Math.ceil(G.timeLeft));
    if (G.timeLeft <= 0) { closeBuy(); G.phase = 'play'; G.phaseAt = now; G.timeLeft = 100; hud.centerMsg('Round live — good hunting', 1300); }
  } else if (G.phase === 'play') {
    G.timeLeft -= dt;
    const m = Math.floor(Math.max(0, G.timeLeft) / 60), s = Math.floor(Math.max(0, G.timeLeft) % 60);
    hud.el.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (G.timeLeft <= 0) endRound('def', 'Time expired — no plant');
  } else if (G.phase === 'planted') {
    G.timeLeft -= dt;
    hud.el.timer.textContent = 'PLANTED';
    hud.el.plantedTimer.textContent = Math.max(0, Math.ceil(G.timeLeft));
    // Accelerating beeps as the fuse burns down.
    const interval = G.timeLeft > 20 ? 1 : G.timeLeft > 10 ? 0.5 : 0.25;
    if (now > bomb.beepAt) { audio.plantBeep(G.timeLeft < 5); bomb.beepAt = now + interval; bombLight.intensity = 8; bombLight.position.set(bomb.pos.x, 1, bomb.pos.z); }
    if (Math.random() < dt * 2) bombLight.intensity = 2;
    if (G.timeLeft <= 0) explodeBomb();
  } else if (G.phase === 'roundEnd') {
    hud.el.timer.textContent = '—';
    if (now - G.phaseAt > 3.4 && G.scoreAtk < WIN_SCORE && G.scoreDef < WIN_SCORE) { G.round++; startRound(); }
  }
}

// ---------- effects update ----------
function updateEffects(now) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (now > e.until) { scene.remove(e.obj); e.obj.geometry?.dispose(); effects.splice(i, 1); continue; }
    if (e.kind === 'burst') {
      const pos = e.obj.geometry.attributes.position;
      for (let j = 0; j < e.vels.length; j++) {
        pos.setXYZ(j, pos.getX(j) + e.vels[j].x * 0.016, pos.getY(j) + e.vels[j].y * 0.016, pos.getZ(j) + e.vels[j].z * 0.016);
        e.vels[j].y -= 0.12;
      }
      pos.needsUpdate = true;
    }
  }
  muzzle.intensity = Math.max(0, muzzle.intensity - 1.6);
}

// ---------- staged scenes for the screenshot kit ----------
function stageScene() {
  hud.show('menu', false); hud.show('hud', true);
  G.round = 3; G.scoreAtk = 2; G.scoreDef = 1;
  for (const f of allFighters()) { f.money = 3400; }
  player.primary = new WeaponInstance(WEAPONS.rifle); player.current = player.primary;
  player.armorPts = 100;
  startRound();
  closeBuy();
  G.phase = 'play'; G.timeLeft = 67;
  const pose = (b, x, z, yaw) => { b.pos.set(x, 0, z); b.mesh.position.set(x, 0, z); b.yaw = yaw; b.mesh.rotation.y = yaw; };
  if (SHOT === 'start' || SHOT === 'buy') {
    G.phase = 'buy'; G.timeLeft = 11; openBuy();
    player.pos.set(SPAWN_ATK.x - 3, 0, SPAWN_ATK.z); player.yaw = Math.PI;
  } else if (SHOT === 'play' || SHOT === 'firefight') {
    player.pos.set(-2, 0, 14); player.yaw = 0.35; player.pitch = -0.02;
    const atk = bots.filter(b => b.team === 'atk'), def = bots.filter(b => b.team === 'def');
    pose(atk[0], -6, 10, 0.3); pose(atk[1], 4, 18, -0.2); pose(atk[2], -10, 22, 0.1); pose(atk[3], 8, 26, 0);
    pose(def[0], 1, -2, Math.PI - 0.3); pose(def[1], -8, 2, Math.PI + 0.2); pose(def[2], 10, -6, Math.PI);
    pose(def[3], -16, -6, Math.PI - 0.4); pose(def[4], 18, 2, Math.PI + 0.3);
    // Frozen action dressing: tracers mid-flight and a fresh hit marker.
    const o1 = new THREE.Vector3(-2, 1.6, 13.4), t1 = new THREE.Vector3(0.6, 1.5, -1.6);
    tracer(o1, t1, 9999); tracer(new THREE.Vector3(1, 1.6, -1.4), new THREE.Vector3(-2.4, 1.4, 12), 9999);
    impactFX(t1, 8, 0xff6a4d);
    hud.hitmark(false);
    hud.addFeed('You ▸ Havoc', '#ffa04d'); hud.addFeed('Iris ▸ Milo', '#7db8ff');
    player.hp = 72;
  } else if (SHOT === 'plant') {
    G.phase = 'planted'; G.timeLeft = 23; bomb.site = SITE_A; bomb.state = 'planted';
    bomb.pos.set(SITE_A.x, 0, SITE_A.z);
    bombMesh.position.set(SITE_A.x, 0.15, SITE_A.z); bombMesh.visible = true;
    hud.show('bombWarn', true); hud.el.plantedTimer.textContent = '23';
    player.pos.set(SITE_A.x + 5, 0, SITE_A.z + 6); player.yaw = 0.7; player.pitch = -0.08;
    hud.interact('Defusing…', 0.45);
    hud.el.interact.querySelector('.ilabel').textContent = 'Enemy defusing the charge!';
    const def = bots.filter(b => b.team === 'def');
    pose(def[0], SITE_A.x + 0.8, SITE_A.z + 0.6, 2.8);
  } else if (SHOT === 'end') {
    G.scoreAtk = 3; G.phase = 'roundEnd';
    hud.banner('ROUND WON', 'Defenders eliminated — Attackers take the round', 0);
    player.pos.set(0, 0, 22); player.yaw = 0.15;
  } else if (SHOT === 'overview') {
    player.pos.set(0, 0, 46);
  }
  // Timers do not run in staged mode, so sync the static HUD readouts here.
  hud.el.scoreAtk.textContent = G.scoreAtk;
  hud.el.scoreDef.textContent = G.scoreDef;
  hud.el.timer.textContent = SHOT === 'start' || SHOT === 'buy' ? 'BUY 11'
    : SHOT === 'plant' ? 'PLANTED' : SHOT === 'end' ? '—' : '1:07';
  if (SHOT === 'plant' || SHOT === 'end') hud.el.centerMsg.style.opacity = '0';
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const now = perfNow();
  if (G.phase !== 'menu') {
    updatePlayer(dt, now);
    // Staged scenes stay frozen exactly as posed: no bot simulation, no
    // timers, so the screenshot kit captures the intended composition.
    if (!G.staged) {
      updateBots(dt, now);
      updateGrenades(dt, now);
      updateTimers(dt, now);
    }
  }
  updateEffects(now);
  if (G.staged && SHOT === 'overview') {
    camera.position.set(0, 62, 34);
    camera.lookAt(0, 0, -8);
    viewGun.visible = false;
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (G.staged) stageScene();
animate();
