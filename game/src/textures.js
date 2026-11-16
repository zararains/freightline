// textures.js — all textures are procedural canvas art. No external assets.
// Design decision: generate small canvases once, reuse with repeat wrapping so
// the trainyard reads as sun-baked concrete, gravel and corrugated steel.
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(ctx, w, h, base, fleck, n) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = fleck[Math.floor(Math.random() * fleck.length)];
    ctx.globalAlpha = 0.12 + Math.random() * 0.25;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

export function makeTextures() {
  const concrete = canvas(256, 256, (ctx, w, h) => {
    noise(ctx, w, h, '#9a8f7d', ['#8a7f6d', '#aca191', '#7d7261'], 2600);
    ctx.strokeStyle = 'rgba(60,52,40,0.35)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  });
  concrete.repeat.set(10, 10);

  const gravel = canvas(256, 256, (ctx, w, h) => {
    noise(ctx, w, h, '#6f6353', ['#5d5344', '#847763', '#94866c', '#4e4638'], 5200);
  });
  gravel.repeat.set(16, 16);

  const corrugated = (base, shade) => canvas(256, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, shade); g.addColorStop(0.5, base); g.addColorStop(1, shade);
      ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = 'rgba(70,45,20,0.25)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });

  const hazard = canvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#22201c';
    for (let i = -2; i < 6; i++) {
      ctx.save(); ctx.translate(i * 32, 0); ctx.rotate(0.6);
      ctx.fillRect(0, -40, 14, h + 90); ctx.restore();
    }
  });

  const crateWood = canvas(128, 128, (ctx, w, h) => {
    noise(ctx, w, h, '#8a6b42', ['#77592f', '#9c7d4e'], 500);
    ctx.strokeStyle = '#5d4525'; ctx.lineWidth = 7; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.lineWidth = 5; ctx.stroke();
  });

  const metalDark = canvas(128, 128, (ctx, w, h) => {
    noise(ctx, w, h, '#4c4f52', ['#3d4043', '#5d6063'], 700);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 16; y < h; y += 32) ctx.fillRect(0, y, w, 2);
  });

  const sign = (letter, bg, fg) => canvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg; ctx.lineWidth = 10; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = fg; ctx.font = 'bold 170px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 8);
  });

  const label = (text, bg) => canvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f3ead8'; ctx.font = 'bold 52px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  });

  return {
    concrete, gravel, hazard, crateWood, metalDark,
    containerRed: corrugated('#a63c2a', '#7e2c1e'),
    containerBlue: corrugated('#2e5f8a', '#214a6c'),
    containerGreen: corrugated('#4a7a3f', '#385e30'),
    containerYellow: corrugated('#c79a2e', '#9c7822'),
    containerTeal: corrugated('#2f7d78', '#25625e'),
    signA: sign('A', '#8a2f22', '#f6e9d2'),
    signB: sign('B', '#24507a', '#e8f0f8'),
    labelDepot: label('FUEL DEPOT', '#6e2a1e'),
    labelDock: label('LOADING DOCK', '#1e4468'),
    labelYard: label('FREIGHTLINE YARD 7', '#3c3a34'),
  };
}
