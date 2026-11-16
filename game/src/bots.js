// bots.js — bot combatants. Design: waypoint pathing toward an objective,
// perception by line-of-sight + hearing radius, burst fire with human-like
// reaction delay and spread so fights feel fair rather than aimbot-hard.
import * as THREE from 'three';
import { WEAPONS, WeaponInstance } from './weapons.js';
import { collide, findPath, losBlocked } from './world.js';

export const ATK_NAMES = ['Vex', 'Milo', 'Sable', 'Rook'];
export const DEF_NAMES = ['Havoc', 'Iris', 'Bruno', 'Koda', 'Fenn'];

const ATK_COLOR = 0xd96c2c, DEF_COLOR = 0x2c6fd9;

export function makeBotMesh(team) {
  const g = new THREE.Group();
  const color = team === 'atk' ? ATK_COLOR : DEF_COLOR;
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.34), bodyMat);
  body.position.y = 1.02; body.castShadow = true; g.add(body);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), darkMat);
  legs.position.y = 0.3; legs.castShadow = true; g.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9a877, roughness: 0.7 }));
  head.position.y = 1.66; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.46), bodyMat);
  cap.position.y = 1.84; g.add(cap);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), darkMat);
  gun.position.set(0.22, 1.28, -0.4); g.add(gun);
  g.userData.head = head; g.userData.body = body;
  return g;
}

export class Bot {
  constructor(name, team, world, spawnIdx) {
    this.name = name; this.team = team;
    this.world = world;
    this.mesh = makeBotMesh(team);
    this.pos = this.mesh.position;
    this.yaw = team === 'atk' ? Math.PI : 0;
    this.hp = 100; this.armor = false; this.alive = true;
    this.money = 800; this.kills = 0; this.deaths = 0;
    this.primary = null; this.sidearm = new WeaponInstance(WEAPONS.pistol);
    this.frag = 0; this.smoke = 0; this.hasKit = team === 'def';
    this.hasBomb = false;
    this.path = []; this.pathIdx = 0;
    this.state = 'advance'; // advance | engage | hold | plant | defuse | retreat
    this.target = null; this.reactionAt = 0; this.nextShotAt = 0;
    this.holdUntil = 0; this.lastSeenEnemy = null; this.lastSeenAt = -99;
    this.heardAt = -99; this.heardPos = null;
    this.strafeDir = 1; this.strafeFlipAt = 0;
    this.objective = null; this.spawnIdx = spawnIdx;
    this.speedBase = 4.4 + Math.random() * 0.5;
    this.skill = 0.75 + Math.random() * 0.45; // aim quality scalar
  }
  weapon() { return this.primary || this.sidearm; }
  eyeY() { return 1.62; }
  resetForRound(spawnPos, yaw) {
    this.hp = 100; this.alive = true;
    this.pos.set(spawnPos.x, 0, spawnPos.z);
    this.yaw = yaw; this.path = []; this.state = 'advance';
    this.target = null; this.lastSeenEnemy = null;
    this.mesh.visible = true;
  }
  buyRound(rng) {
    // Simple economy: armor first, then the best primary affordable.
    if (!this.armor && this.money >= 650) { this.money -= 650; this.armor = true; }
    if (this.money >= 2700) { this.primary = new WeaponInstance(WEAPONS.rifle); this.money -= 2700; }
    else if (!this.primary && this.money >= 1250) { this.primary = new WeaponInstance(WEAPONS.smg); this.money -= 1250; }
    else if (this.money >= 4700) { this.primary = new WeaponInstance(WEAPONS.sniper); this.money -= 4500; }
    if (this.money >= 300 && this.frag === 0 && rng() < 0.5) { this.frag = 1; this.money -= 300; }
  }
  setPathTo(x, z) {
    this.path = findPath(this.world.nodes, this.world.edges, this.pos.x, this.pos.z, x, z);
    this.pathIdx = 0;
  }
  // Returns events for the game to resolve: {type:'shoot',...} etc.
  update(dt, now, ctx) {
    const events = [];
    if (!this.alive) return events;
    const enemies = ctx.enemies.filter(e => e.alive);
    // Perception: nearest visible enemy within 65 units.
    let vis = null, visD = 1e9;
    for (const e of enemies) {
      const ex = e.pos ? e.pos.x : e.mesh.position.x;
      const ez = e.pos ? e.pos.z : e.mesh.position.z;
      const ey = e.eyeY ? e.eyeY() : 1.62;
      const d = Math.hypot(ex - this.pos.x, ez - this.pos.z);
      if (d > 65) continue;
      if (!losBlocked(this.pos.x, this.eyeY(), this.pos.z, ex, ey, ez, ctx.colliders)) {
        if (d < visD) { visD = d; vis = e; }
      }
    }
    if (vis) {
      if (this.target !== vis) { this.target = vis; this.reactionAt = now + 0.32 / this.skill; }
      this.lastSeenEnemy = { x: vis.pos.x, z: vis.pos.z }; this.lastSeenAt = now;
    } else if (now - this.lastSeenAt > 2.5) this.target = null;

    const wantPlant = ctx.phase === 'play' && this.hasBomb && ctx.atMySite(this);
    const wantDefuse = ctx.phase === 'planted' && this.team === 'def' && ctx.nearBomb(this, 2.2);

    if (wantPlant) { this.state = 'plant'; events.push({ type: 'plantHold', bot: this }); return events; }
    if (wantDefuse) { this.state = 'defuse'; events.push({ type: 'defuseHold', bot: this }); return events; }

    if (this.target && now >= this.reactionAt) {
      this.state = 'engage';
      const tp = this.target.pos;
      this.yaw = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
      // Strafe while engaging to stay a hard target.
      if (now > this.strafeFlipAt) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeFlipAt = now + 0.6 + Math.random() * 0.8; }
      const sx = Math.cos(this.yaw) * this.strafeDir, sz = -Math.sin(this.yaw) * this.strafeDir;
      this.pos.x += sx * dt * 1.6; this.pos.z += sz * dt * 1.6;
      collide(this.pos, 0.45, ctx.colliders, 0);
      if (now >= this.nextShotAt) {
        const w = this.weapon();
        if (w.ammo <= 0) { if (w.reserve > 0) { const take = Math.min(w.def.mag - w.ammo, w.reserve); w.ammo += take; w.reserve -= take; this.nextShotAt = now + w.def.reloadTime; } }
        else {
          w.ammo--;
          this.nextShotAt = now + w.interval() * (0.9 + Math.random() * 0.35);
          events.push({ type: 'shoot', bot: this, target: this.target });
        }
      }
    } else {
      // Objective movement.
      const obj = ctx.objectiveFor(this);
      if (this.state !== 'hold' || now > this.holdUntil) {
        this.state = 'advance';
        const needPath = !this.path.length || this.pathIdx >= this.path.length ||
          Math.hypot((this.path[this.path.length - 1]?.x ?? obj.x) - obj.x, (this.path[this.path.length - 1]?.z ?? obj.z) - obj.z) > 4;
        if (needPath) this.setPathTo(obj.x, obj.z);
      }
      if (this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.1) this.pathIdx++;
        else {
          this.yaw = Math.atan2(-dx, -dz);
          const sp = this.speedBase * (this.weapon().def.moveSpeed);
          this.pos.x += (dx / d) * sp * dt; this.pos.z += (dz / d) * sp * dt;
          collide(this.pos, 0.45, ctx.colliders, 0);
        }
      } else if (this.team === 'def' && ctx.phase === 'play') {
        // Defenders settle into a hold angle near their site.
        this.state = 'hold'; this.holdUntil = now + 1.2;
        this.yaw += Math.sin(now * 0.4 + this.spawnIdx) * dt * 0.25;
      }
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    return events;
  }
}
