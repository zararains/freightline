// weapons.js — weapon catalogue. Each gun is tuned as a distinct role:
// pistol is the free starter, SMG trades damage for rate and mobility,
// rifle is the all-rounder, sniper one-shots through scope at long range.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', slot: 'sidearm', price: 0, damage: 26, headMult: 2.5,
    rpm: 320, auto: false, mag: 12, reserveStart: 48, spreadBase: 0.011, spreadMove: 0.03, spreadBloom: 0.006,
    recoil: 0.011, range: 55, falloffStart: 22, moveSpeed: 1.0, reloadTime: 1.4, zoom: 1.0 },
  smg: { id: 'smg', name: 'VK-9 SMG', slot: 'primary', price: 1250, damage: 21, headMult: 2.5,
    rpm: 780, auto: true, mag: 30, reserveStart: 90, spreadBase: 0.02, spreadMove: 0.028, spreadBloom: 0.004,
    recoil: 0.008, range: 45, falloffStart: 14, moveSpeed: 1.03, reloadTime: 1.9, zoom: 1.0 },
  rifle: { id: 'rifle', name: 'AR-47 Rifle', slot: 'primary', price: 2700, damage: 34, headMult: 2.5,
    rpm: 600, auto: true, mag: 30, reserveStart: 90, spreadBase: 0.012, spreadMove: 0.034, spreadBloom: 0.005,
    recoil: 0.014, range: 80, falloffStart: 30, moveSpeed: 0.97, reloadTime: 2.3, zoom: 1.0 },
  sniper: { id: 'sniper', name: 'Longshot .50', slot: 'primary', price: 4500, damage: 110, headMult: 2.5,
    rpm: 42, auto: false, mag: 5, reserveStart: 20, spreadBase: 0.045, spreadMove: 0.09, spreadBloom: 0.02,
    recoil: 0.06, range: 140, falloffStart: 70, moveSpeed: 0.92, reloadTime: 3.1, zoom: 3.2 },
};
export const ARMOR_PRICE = 650;
export const FRAG_PRICE = 300;
export const SMOKE_PRICE = 300;
export const KIT_PRICE = 400;

export function falloffDamage(def, dist) {
  if (dist <= def.falloffStart) return def.damage;
  const t = Math.min(1, (dist - def.falloffStart) / Math.max(1, def.range - def.falloffStart));
  return def.damage * (1 - 0.55 * t);
}

export class WeaponInstance {
  constructor(def) {
    this.def = def;
    this.ammo = def.mag;
    this.reserve = def.reserveStart;
    this.lastShot = -1;
    this.bloom = 0;
    this.reloadingUntil = 0;
  }
  interval() { return 60 / this.def.rpm; }
}
