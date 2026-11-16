// world.js — the Freightline trainyard. Layout intent: two lanes (west
// container maze to A, east warehouse/dock to B) joined by a mid yard so
// rotations matter. Every solid registers an AABB collider used by movement,
// bot navigation and bullet blocking alike — one source of truth.
import * as THREE from 'three';
import { makeTextures } from './textures.js';

export const SITE_A = { x: -36, z: -34, r: 9, name: 'A — Fuel Depot' };
export const SITE_B = { x: 36, z: -34, r: 9, name: 'B — Loading Dock' };
export const SPAWN_ATK = { x: 0, z: 46 };
export const SPAWN_DEF = { x: 0, z: -46 };

export function buildWorld(scene) {
  const tex = makeTextures();
  const colliders = []; // {minX,maxX,minZ,maxZ,h}
  const solids = new THREE.Group();
  scene.add(solids);

  // Golden-hour lighting: low warm sun, soft shadows, gentle fog.
  scene.fog = new THREE.Fog(0xe8b98a, 55, 150);
  const skyGeo = new THREE.SphereGeometry(400, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 top=vec3(0.35,0.55,0.85); vec3 mid=vec3(0.98,0.72,0.45); vec3 low=vec3(1.0,0.55,0.30); vec3 c=h>0.25?mix(mid,top,smoothstep(0.25,0.9,h)):mix(low,mid,smoothstep(-0.05,0.25,h)); gl_FragColor=vec4(c,1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
  sun.position.set(-45, 38, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 180; sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe0b8, 0x5a4a38, 0.85));

  const groundMat = new THREE.MeshStandardMaterial({ map: tex.gravel, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  // Concrete apron under the sites and mid.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.02, -20); apron.receiveShadow = true;
  scene.add(apron);

  function box(x, z, w, d, h, mat, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    solids.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: y + h });
    return m;
  }
  const contMats = [tex.containerRed, tex.containerBlue, tex.containerGreen, tex.containerYellow, tex.containerTeal]
    .map(t => new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.25 }));
  let ci = 0;
  function container(x, z, rot90 = false, stack = false) {
    const w = rot90 ? 2.6 : 6.2, d = rot90 ? 6.2 : 2.6;
    box(x, z, w, d, 2.6, contMats[ci++ % contMats.length]);
    if (stack) box(x, z, w, d, 2.6, contMats[ci++ % contMats.length], 2.6);
  }
  const crateMat = new THREE.MeshStandardMaterial({ map: tex.crateWood, roughness: 0.9 });
  function crates(x, z, n = 2) { for (let i = 0; i < n; i++) box(x + (i % 2) * 1.3 - 0.6, z + Math.floor(i / 2) * 1.3, 1.25, 1.25, 1.25, crateMat, Math.floor(i / 2) * 0); if (n > 2) box(x, z, 1.25, 1.25, 1.25, crateMat, 1.25); }
  const metalMat = new THREE.MeshStandardMaterial({ map: tex.metalDark, roughness: 0.6, metalness: 0.5 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8 });

  // Perimeter walls.
  box(0, -62, 128, 2, 5, metalMat); box(0, 62, 128, 2, 5, metalMat);
  box(-62, 0, 2, 128, 5, metalMat); box(62, 0, 2, 128, 5, metalMat);

  // West lane to A: container maze.
  container(-30, 18); container(-38, 8, true); container(-22, 2); container(-44, -12);
  container(-28, -18, false, true); container(-14, -26, true); container(-46, -30);
  container(-18, 30, true); container(-48, 22, true); crates(-34, 28); crates(-12, -8);
  // East lane to B.
  container(30, 18, false, true); container(40, 6, true); container(22, 0); container(46, -14);
  container(26, -20); container(14, -28, true); container(48, -28); crates(34, 28); crates(12, -8);
  // Mid yard cover.
  container(0, 8); container(-6, -14, true); container(8, -18); crates(0, 26); crates(-4, -34); crates(6, 38);

  // Train: two wagons on rails crossing the north third.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.8 });
  for (const rx of [-52, 52]) { /* rails drawn as long thin boxes, non-colliding visual base */ }
  const rail1 = new THREE.Mesh(new THREE.BoxGeometry(120, 0.12, 0.18), railMat);
  rail1.position.set(0, 0.06, -41.2); scene.add(rail1);
  const rail2 = rail1.clone(); rail2.position.z = -39.6; scene.add(rail2);
  const wagonMatA = new THREE.MeshStandardMaterial({ map: tex.containerRed, roughness: 0.7, metalness: 0.3 });
  const wagonMatB = new THREE.MeshStandardMaterial({ map: tex.containerBlue, roughness: 0.7, metalness: 0.3 });
  box(-24, -40.4, 16, 3.2, 3.1, wagonMatA, 0.5);
  box(14, -40.4, 18, 3.2, 3.1, wagonMatB, 0.5);
  // Fuel tanks at A.
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.45, metalness: 0.6 });
  for (const [tx, tz] of [[-44, -40], [-44, -30]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6.5, 14), tankMat);
    tank.rotation.z = Math.PI / 2; tank.position.set(tx, 2.4, tz); tank.castShadow = true;
    scene.add(tank);
    colliders.push({ minX: tx - 3.2, maxX: tx + 3.2, minZ: tz - 2.4, maxZ: tz + 2.4, h: 4.8 });
  }
  // Warehouse shell on the east edge (visual walls with a doorway gap).
  box(56, -6, 2, 22, 7, metalMat); box(48, 4, 18, 2, 7, metalMat); box(48, -16, 18, 2, 7, metalMat);
  // Loading dock platform at B (low, walkable via ramp logic: treated as step).
  const dock = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 10), new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 1 }));
  dock.position.set(38, 0.5, -36); dock.receiveShadow = true; dock.castShadow = true; scene.add(dock);
  colliders.push({ minX: 31, maxX: 45, minZ: -41, maxZ: -31, h: 1, step: true });

  // Site markers: painted rings + hazard pads + big letter signs.
  function siteMark(site, signTex, labelTex) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.7, site.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xffcf4d, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.05, site.z); scene.add(ring);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.9 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(site.x, 0.04, site.z); pad.receiveShadow = true; scene.add(pad);
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: signTex }));
    signMesh.position.set(site.x, 5.4, site.z - 7.5); scene.add(signMesh);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.4, 0.3), metalMat);
    post.position.set(site.x - 3, 2.7, site.z - 7.6); scene.add(post);
    const post2 = post.clone(); post2.position.x = site.x + 3; scene.add(post2);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: labelTex }));
    lab.position.set(site.x, 8.6, site.z - 7.5); scene.add(lab);
  }
  siteMark(SITE_A, tex.signA, tex.labelDepot);
  siteMark(SITE_B, tex.signB, tex.labelDock);
  const yardSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: tex.labelYard }));
  yardSign.position.set(0, 6.4, 60.8); yardSign.rotation.y = Math.PI; scene.add(yardSign);

  // Ramps: two wooden ramps onto the dock and a container-top step near mid.
  const ramps = [
    { x: 29.4, z: -36, w: 3.2, d: 4, h: 1, dir: 'west' },
  ];

  // Navigation waypoints (x,z) — bots path between these nodes.
  const nodes = [
    [0, 46], [-16, 34], [16, 34], [0, 24], [-30, 26], [30, 26], [-16, 10], [16, 10],
    [0, 2], [-32, 12], [32, 12], [-24, -6], [24, -6], [-8, -16], [8, -16],
    [-30, -22], [30, -22], [-36, -34], [36, -34], [-20, -34], [20, -34],
    [0, -30], [0, -44], [-36, -46], [36, -46], [-50, -20], [50, -20], [-50, 30], [50, 30],
  ].map(([x, z], i) => ({ id: i, x, z }));
  const edges = new Map();
  function link(a, b) {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a).push(b); edges.get(b).push(a);
  }
  // Connect each node to its 3 nearest neighbours for a robust graph.
  for (const n of nodes) {
    const sorted = nodes.filter(m => m !== n)
      .sort((a, b) => ((a.x - n.x) ** 2 + (a.z - n.z) ** 2) - ((b.x - n.x) ** 2 + (b.z - n.z) ** 2));
    for (let k = 0; k < 3; k++) link(n.id, sorted[k].id);
  }

  return { colliders, nodes, edges, ramps };
}

// Circle vs AABB resolution; returns corrected position. Step colliders
// (dock) only block when the actor is not already above them.
export function collide(pos, radius, colliders, feetY = 0) {
  for (const c of colliders) {
    if (c.step && feetY >= c.h - 0.05) continue;
    if (feetY >= c.h) continue;
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius; pos.z = nz + (dz / d) * radius;
      } else {
        // Inside the box: push out along the smallest penetration axis.
        const pl = pos.x - c.minX, pr = c.maxX - pos.x, pt = pos.z - c.minZ, pb = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.minX - radius; else if (m === pr) pos.x = c.maxX + radius;
        else if (m === pt) pos.z = c.minZ - radius; else pos.z = c.maxZ + radius;
      }
    }
  }
  pos.x = Math.max(-59, Math.min(59, pos.x));
  pos.z = Math.max(-59, Math.min(59, pos.z));
  return pos;
}

export function groundHeightAt(x, z, colliders) {
  let h = 0;
  for (const c of colliders) if (c.step && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) h = Math.max(h, c.h);
  return h;
}

// Segment vs AABB (slab test) in 3D for bullet blocking. Returns t or null.
export function rayHitAABB(ox, oy, oz, dx, dy, dz, c, maxT) {
  let tmin = 0, tmax = maxT;
  const mins = [c.minX, 0, c.minZ], maxs = [c.maxX, c.h, c.maxZ], o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (o[i] < mins[i] || o[i] > maxs[i]) return null; }
    else {
      let t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function losBlocked(ox, oy, oz, tx, ty, tz, colliders) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.01) return false;
  const inv = 1 / dist;
  for (const c of colliders) {
    const t = rayHitAABB(ox, oy, oz, dx * inv, dy * inv, dz * inv, c, dist);
    if (t !== null && t < dist - 0.4) return true;
  }
  return false;
}

export function findPath(nodes, edges, sx, sz, tx, tz) {
  const nearest = (x, z) => {
    let best = null, bd = 1e9;
    for (const n of nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  };
  const start = nearest(sx, sz), goal = nearest(tx, tz);
  if (!start || !goal) return [{ x: tx, z: tz }];
  const prev = new Map(); const dist = new Map([[start.id, 0]]); const open = [start];
  const seen = new Set();
  while (open.length) {
    open.sort((a, b) => (dist.get(a.id) ?? 1e9) - (dist.get(b.id) ?? 1e9));
    const cur = open.shift();
    if (seen.has(cur.id)) continue; seen.add(cur.id);
    if (cur.id === goal.id) break;
    for (const nbId of edges.get(cur.id) || []) {
      const nb = nodes[nbId];
      const nd = (dist.get(cur.id) ?? 1e9) + Math.hypot(nb.x - cur.x, nb.z - cur.z);
      if (nd < (dist.get(nbId) ?? 1e9)) { dist.set(nbId, nd); prev.set(nbId, cur.id); open.push(nb); }
    }
  }
  const path = [];
  let cur = goal.id;
  const guard = new Set();
  while (cur !== undefined && !guard.has(cur)) {
    guard.add(cur);
    const n = nodes[cur]; path.unshift({ x: n.x, z: n.z });
    if (cur === start.id) break;
    cur = prev.get(cur);
  }
  path.push({ x: tx, z: tz });
  return path;
}
