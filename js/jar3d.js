// 3D capsule jar: three.js scene + cannon-es physics.
// Usage:
//   const jar = new Jar(el, { count: 90 });
//   jar.setTarget([{color:'#e2493f', shape:'star'}, ...]);   // keeps the jar matching current odds
//   await jar.stir(); await jar.grab(spec); await jar.open();
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as CANNON from 'cannon-es';

const BW = 6, BH = 10, BD = 3.6;   // inner box (world units). floor y=0, centered on x/z
const FRAME = 0.5;                 // front frame thickness
const FOV = 38;
import { SHAPES } from './shapes.js';
export { SHAPES };
const key = (s) => String(s.color).toLowerCase() + '|' + (SHAPES.includes(s.shape) ? s.shape : 'sphere');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function concreteTexture(base, seed) {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 70; i++) {            // soft blotches
    const r = 20 + rnd() * 90, px = rnd() * s, py = rnd() * s;
    const gr = g.createRadialGradient(px, py, 0, px, py, r);
    const a = 0.05 + rnd() * 0.07, dark = rnd() < 0.5;
    gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
  }
  const img = g.getImageData(0, 0, s, s), d = img.data;   // grain
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 260; i++) {           // pores
    g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.2})`;
    g.beginPath(); g.arc(rnd() * s, rnd() * s, 0.6 + rnd() * 1.6, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function stripeTexture(color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 8;
  const g = c.getContext('2d'), n = 16, w = c.width / n;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#f6f4ef' : color; g.fillRect(i * w, 0, w, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function buildGeometries(r) {
  const sphere = new THREE.SphereGeometry(r, 40, 28);

  // ribbed "lantern" ball
  const stripe = new THREE.SphereGeometry(r, 96, 32);
  const p = stripe.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const az = Math.atan2(v.z, v.x), k = 1 - 0.045 * (0.5 + 0.5 * Math.cos(az * 16));
    v.x *= k; v.z *= k; p.setXYZ(i, v.x, v.y, v.z);
  }
  stripe.computeVertexNormals();

  // spiky star ball: core + 12 cones on icosahedron vertices
  const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position, dirs = [];
  for (let i = 0; i < ico.count; i++) {
    const d = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
    if (!dirs.some((q) => q.distanceTo(d) < 1e-3)) dirs.push(d);
  }
  const up = new THREE.Vector3(0, 1, 0);
  const starParts = [new THREE.SphereGeometry(r * 0.74, 32, 20)];
  for (const d of dirs) {
    const cone = new THREE.ConeGeometry(r * 0.3, r * 0.5, 20);
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    cone.translate(d.x * r * 0.74, d.y * r * 0.74, d.z * r * 0.74);
    starParts.push(cone);
  }
  const star = mergeGeometries(starParts);

  // bumpy clover ball: core + 6 lobes
  const cl = [new THREE.SphereGeometry(r * 0.66, 28, 18)];
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const lobe = new THREE.SphereGeometry(r * 0.5, 24, 16);
    lobe.translate(d[0] * r * 0.5, d[1] * r * 0.5, d[2] * r * 0.5);
    cl.push(lobe);
  }
  const clover = mergeGeometries(cl);
  clover.rotateX(0.6); clover.rotateZ(0.4);

  const inner = new THREE.SphereGeometry(r * 0.5, 28, 18);
  const top = new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  return { sphere, stripe, star, clover, glass: sphere, inner, top, bot };
}

export class Jar {
  constructor(el, opts = {}) {
    this.el = el;
    this.count = opts.count || 90;
    this.balls = [];          // {spec, key, mesh, body, dying}
    this.tweens = [];
    this.mats = new Map();
    this.presented = null;
    this.targetKeys = null;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#2b2e33');
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    // lights
    scene.add(new THREE.HemisphereLight('#f4f6ff', '#4a4640', 0.55));
    const key = new THREE.DirectionalLight('#fff6ea', 2.4);
    key.position.set(-3, BH + 6, BD + 8);
    key.target.position.set(0, 2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -BW, right: BW, top: BH, bottom: -2, near: 1, far: 40 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    scene.add(key, key.target);
    const fill = new THREE.PointLight('#dfe8ff', 18, 30, 1.6);
    fill.position.set(BW * 0.4, BH * 0.85, BD * 0.2);
    scene.add(fill);

    this.buildBox();
    this.buildPhysics();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(el);

    this.last = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  buildBox() {
    const wallMat = (base, seed, rx, ry) => {
      const t = concreteTexture(base, seed); t.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0, envMapIntensity: 0.4 });
    };
    const add = (geo, mat, pos, rot) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot);
      m.receiveShadow = true; this.scene.add(m); return m;
    };
    const back = wallMat('#a7adb3', 1, 1, 1.6), side = wallMat('#969ca3', 2, 0.6, 1.6);
    const floor = wallMat('#8a9097', 3, 1, 0.6), ceil = wallMat('#7d838a', 4, 1, 0.6);
    add(new THREE.PlaneGeometry(BW, BH), back, [0, BH / 2, -BD / 2]);
    add(new THREE.PlaneGeometry(BD, BH), side, [-BW / 2, BH / 2, 0], [0, Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(BD, BH), side, [BW / 2, BH / 2, 0], [0, -Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(BW, BD), floor, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    add(new THREE.PlaneGeometry(BW, BD), ceil, [0, BH, 0], [Math.PI / 2, 0, 0]);
    // recessed header plate (title is an HTML overlay on top of it)
    const plate = add(new THREE.BoxGeometry(BW, 1.5, 0.5), wallMat('#8f959c', 5, 1, 0.25), [0, BH - 0.75, -BD / 2 + 0.25]);
    plate.castShadow = true;

    // dark metal frame around the opening
    const fm = new THREE.MeshStandardMaterial({ color: '#2f3237', roughness: 0.45, metalness: 0.6 });
    const z = BD / 2 + 0.3;
    const bar = (w, h, x, y) => { const m = add(new THREE.BoxGeometry(w, h, 0.6), fm, [x, y, z]); m.castShadow = false; };
    bar(BW + FRAME * 2, FRAME, 0, BH + FRAME / 2);
    bar(BW + FRAME * 2, FRAME, 0, -FRAME / 2);
    bar(FRAME, BH, -BW / 2 - FRAME / 2, BH / 2);
    bar(FRAME, BH, BW / 2 + FRAME / 2, BH / 2);
    // inner lip shadowing the edges
    const lip = new THREE.MeshStandardMaterial({ color: '#1d1f23', roughness: 0.7 });
    add(new THREE.BoxGeometry(BW, 0.08, 0.6), lip, [0, BH - 0.04, BD / 2 - 0.3]);

    // faint front glass sheen
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.06, depthWrite: false, envMapIntensity: 1.2,
    }));
    glass.position.set(0, BH / 2, BD / 2 - 0.02);
    this.scene.add(glass);
  }

  buildPhysics() {
    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 12;
    w.defaultContactMaterial.friction = 0.22;
    w.defaultContactMaterial.restitution = 0.32;
    const plane = (pos, euler) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      b.position.set(...pos); b.quaternion.setFromEuler(...euler); w.addBody(b);
    };
    plane([0, 0, 0], [-Math.PI / 2, 0, 0]);          // floor
    plane([0, BH, 0], [Math.PI / 2, 0, 0]);          // ceiling
    plane([0, 0, -BD / 2], [0, 0, 0]);               // back
    plane([0, 0, BD / 2], [0, Math.PI, 0]);          // front glass
    plane([-BW / 2, 0, 0], [0, Math.PI / 2, 0]);     // left
    plane([BW / 2, 0, 0], [0, -Math.PI / 2, 0]);     // right
  }

  // ball radius so `count` capsules fill about half the box
  layout() {
    let r = Math.cbrt((0.62 * BW * BD * BH * 0.42) / (this.count * 4.18879));
    r = Math.min(0.8, Math.max(0.28, r));
    const cap = (r) => Math.floor(BW / (2.04 * r)) * Math.floor(BD / (2.04 * r)) * Math.floor((BH - 1.6) / (2.04 * r));
    while (cap(r) < this.count && r > 0.2) r *= 0.97;
    if (this.r !== r) {
      this.r = r;
      this.geos = buildGeometries(r);
      for (const m of this.mats.values()) m.dispose();
      this.mats.clear();
    }
  }

  material(spec) {
    const k = key(spec);
    if (this.mats.has(k)) return this.mats.get(k);
    const color = new THREE.Color(spec.color);
    let m;
    switch (spec.shape) {
      case 'stripe':
        m = new THREE.MeshPhysicalMaterial({ map: stripeTexture(spec.color), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 });
        break;
      case 'glass':
        m = new THREE.MeshPhysicalMaterial({
          color: color.clone().lerp(new THREE.Color('#ffffff'), 0.7), roughness: 0.04, transmission: 1, thickness: this.r * 0.6,
          ior: 1.45, clearcoat: 1, envMapIntensity: 1.4, attenuationColor: color, attenuationDistance: this.r * 4,
        });
        m.userData.inner = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.6 });
        break;
      case 'star':
      case 'clover':
        m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 });
        break;
      default:
        m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.22 });
    }
    this.mats.set(k, m);
    return m;
  }

  makeMesh(spec) {
    const shape = SHAPES.includes(spec.shape) ? spec.shape : 'sphere';
    const mat = this.material({ ...spec, shape });
    const mesh = new THREE.Mesh(this.geos[shape], mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (shape === 'glass') {
      const inner = new THREE.Mesh(this.geos.inner, mat.userData.inner);
      inner.castShadow = true; mesh.add(inner);
    }
    return mesh;
  }

  addBall(spec, pos) {
    const r = this.r;
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(r), linearDamping: 0.08, angularDamping: 0.25 });
    body.sleepSpeedLimit = 0.12; body.sleepTimeLimit = 0.6;
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    body.velocity.set((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
    this.world.addBody(body);
    const mesh = this.makeMesh(spec);
    this.scene.add(mesh);
    const b = { spec: { color: spec.color, shape: spec.shape }, key: key(spec), mesh, body };
    this.balls.push(b);
    this.sync(b);
    return b;
  }

  removeBall(b, animate = true) {
    const i = this.balls.indexOf(b); if (i >= 0) this.balls.splice(i, 1);
    this.world.removeBody(b.body);
    if (!animate) { this.scene.remove(b.mesh); return; }
    const s0 = b.mesh.scale.x;
    this.tween(350, (e) => b.mesh.scale.setScalar(s0 * (1 - e)), () => this.scene.remove(b.mesh));
  }

  // specs: array of {color, shape}; length = desired capsule count
  setTarget(specs) {
    const first = !this.targetKeys;
    if (specs.length !== this.count || first) { this.count = Math.max(1, specs.length); }
    const oldR = this.r;
    this.layout();
    if (oldR !== this.r) {               // size changed → rebuild everything
      for (const b of [...this.balls]) this.removeBall(b, false);
    }
    this.targetKeys = specs.map(key);

    const want = new Map();
    for (const s of specs) { const k = key(s); want.set(k, (want.get(k) || { spec: s, n: 0 })); want.get(k).n++; }
    const have = new Map();
    for (const b of this.balls) (have.get(b.key) || have.set(b.key, []).get(b.key)).push(b);

    // remove surplus (highest first, they're the visible ones on top)
    for (const [k, list] of have) {
      const n = want.get(k)?.n || 0;
      if (list.length > n) list.sort((a, b) => b.body.position.y - a.body.position.y).slice(0, list.length - n).forEach((b) => this.removeBall(b));
    }
    const missing = [];
    for (const [k, w] of want) { const n = (have.get(k) || []).length; for (let i = n; i < w.n; i++) missing.push(w.spec); }
    missing.sort(() => Math.random() - 0.5);

    if (!this.balls.length) {            // empty jar: stack on a grid so nothing overlaps
      const r = this.r, sp = 2.04 * r;
      const nx = Math.floor(BW / sp), nz = Math.floor(BD / sp);
      const pts = [];
      for (let y = 0; pts.length < missing.length; y++)
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++)
          pts.push({ x: (ix - (nx - 1) / 2) * sp + (y % 2 ? 0.5 : -0.5) * r * 0.8 + (Math.random() - 0.5) * r * 0.3, y: r + y * sp * 1.08 + 0.05, z: (iz - (nz - 1) / 2) * sp + (Math.random() - 0.5) * r * 0.3 });
      missing.forEach((s, i) => this.addBall(s, pts[i]));
      setTimeout(() => this.stir(600), 400);
    } else {                             // trickle new capsules in from the top
      missing.forEach((s, i) => setTimeout(() => {
        this.addBall(s, { x: (Math.random() - 0.5) * (BW - 2 * this.r), y: BH - 1.6 - this.r, z: (Math.random() - 0.5) * (BD - 2 * this.r) });
      }, i * 90));
    }
  }

  // blow air from below for `ms`
  stir(ms = 1200) {
    return new Promise((res) => {
      const t0 = performance.now();
      const kick = () => {
        for (const b of this.balls) {
          b.body.wakeUp();
          if (Math.random() < 0.55) {
            const low = 1 - Math.min(1, b.body.position.y / (BH * 0.6));
            b.body.applyImpulse(new CANNON.Vec3((Math.random() - 0.5) * 5, 3 + low * 9 + Math.random() * 4, (Math.random() - 0.5) * 3));
          }
        }
        if (performance.now() - t0 < ms) setTimeout(kick, 130); else setTimeout(res, 250);
      };
      kick();
    });
  }

  // lift a capsule of this spec out of the jar to the front of the camera
  grab(spec) {
    const k = key(spec);
    let cands = this.balls.filter((b) => b.key === k);
    if (!cands.length) cands = this.balls.filter((b) => b.spec.color.toLowerCase() === String(spec.color).toLowerCase());
    let b;
    if (cands.length) {
      cands.sort((a, c) => c.body.position.y - a.body.position.y);
      b = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
      this.balls.splice(this.balls.indexOf(b), 1);
      this.world.removeBody(b.body);
    } else {                              // jar has no such capsule (e.g. blank with blank hidden): make one at the top
      const mesh = this.makeMesh(spec); mesh.position.set(0, BH * 0.7, 0); this.scene.add(mesh);
      b = { spec, key: k, mesh };
    }
    if (b.key !== k) {                    // same color, other shape: swap the look
      this.scene.remove(b.mesh); const m = this.makeMesh(spec); m.position.copy(b.mesh.position); m.quaternion.copy(b.mesh.quaternion); this.scene.add(m); b.mesh = m;
    }
    for (const o of this.balls) o.body.wakeUp();   // let the pile settle into the gap

    const mesh = b.mesh, p0 = mesh.position.clone(), q0 = mesh.quaternion.clone();
    const { pos: p2, scale: s2 } = this.presentPose();
    const p1 = new THREE.Vector3(p0.x * 0.5, Math.max(p0.y, BH * 0.55) + 2.5, BD * 0.2);
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, Math.PI * 4, 0.2));
    const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.4, 0));
    this.presented = b;
    return new Promise((res) => {
      this.tween(1300, (t) => {
        const e = ease(t), u = 1 - e;
        mesh.position.set(
          u * u * p0.x + 2 * u * e * p1.x + e * e * p2.x,
          u * u * p0.y + 2 * u * e * p1.y + e * e * p2.y,
          u * u * p0.z + 2 * u * e * p1.z + e * e * p2.z);
        mesh.scale.setScalar(1 + (s2 - 1) * e);
        mesh.quaternion.copy(q0).slerp(spin, Math.min(1, e * 1.4)).slerp(q2, e);
      }, () => {
        const base = mesh.quaternion.clone();
        this.tween(900, (t) => {             // little shake before opening
          const a = Math.sin(t * Math.PI * 9) * 0.22 * (1 - t * 0.3);
          mesh.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a)));
        }, res);
      });
    });
  }

  presentPose() {
    const cam = this.camera.position, front = new THREE.Vector3(0, BH * 0.5, BD / 2);
    const pos = front.clone().lerp(cam, 0.5);
    pos.y += 0.6;
    const d = cam.distanceTo(pos), viewH = 2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const viewW = viewH * this.camera.aspect;
    const scale = (Math.min(viewH * 0.26, viewW * 0.42)) / (2 * this.r);
    return { pos, scale };
  }

  // split the presented capsule into two halves that fly apart
  open() {
    const b = this.presented; if (!b) return Promise.resolve();
    this.presented = null;
    const mesh = b.mesh, pos = mesh.position.clone(), s = mesh.scale.x;
    this.scene.remove(mesh);
    const mat = this.material({ ...b.spec, shape: b.spec.shape === 'stripe' ? 'stripe' : 'sphere' }).clone();
    mat.side = THREE.DoubleSide; mat.transparent = true;
    const top = new THREE.Mesh(this.geos.top, mat), bot = new THREE.Mesh(this.geos.bot, mat);
    for (const h of [top, bot]) { h.position.copy(pos); h.scale.setScalar(s); this.scene.add(h); }
    const sx = this.r * s;
    return new Promise((res) => this.tween(900, (t) => {
      const e = easeOut(t);
      top.position.set(pos.x - e * sx * 1.6, pos.y + e * sx * 2.2, pos.z + e * sx * 0.5);
      bot.position.set(pos.x + e * sx * 1.4, pos.y - e * sx * 2.6, pos.z + e * sx * 0.3);
      top.rotation.set(-e * 1.2, 0, e * 0.9); bot.rotation.set(e * 0.9, 0, -e * 0.7);
      mat.opacity = 1 - Math.max(0, (t - 0.4) / 0.6);
    }, () => { this.scene.remove(top, bot); mat.dispose(); res(); }));
  }

  tween(ms, fn, done) { this.tweens.push({ t0: performance.now(), ms, fn, done }); }

  sync(b) { b.mesh.position.copy(b.body.position); b.mesh.quaternion.copy(b.body.quaternion); }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const cam = this.camera; cam.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const needH = (BH + FRAME * 2) / 2 / t, needW = (BW + FRAME * 2) / 2 / (t * cam.aspect);
    const dist = Math.max(needH, needW) * 1.01;
    cam.position.set(0, BH / 2, BD / 2 + 0.6 + dist);
    cam.lookAt(0, BH / 2, BD / 2);
    cam.updateProjectionMatrix();
  }

  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.world.step(1 / 60, dt, 4);
    for (const b of this.balls) this.sync(b);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i], t = Math.min(1, (now - tw.t0) / tw.ms);
      tw.fn(t);
      if (t >= 1) { this.tweens.splice(i, 1); tw.done && tw.done(); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // where (in CSS px, relative to the container) the jar's opening sits — for overlay layout
  openingRect() {
    const v = (x, y) => { const p = new THREE.Vector3(x, y, BD / 2).project(this.camera); return { x: (p.x + 1) / 2 * this.el.clientWidth, y: (1 - p.y) / 2 * this.el.clientHeight }; };
    const a = v(-BW / 2, BH), b = v(BW / 2, 0);
    return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
  }
}

// Turn the odds pool into exactly `n` capsule specs (largest remainder, at least one per entry).
export function capsuleSpecs(pool, n) {
  if (!pool.length) return [];
  const tot = pool.reduce((a, x) => a + x.w, 0);
  const rows = pool.map((x) => { const exact = (n * x.w) / tot; return { x, k: Math.max(1, Math.floor(exact)), rem: exact - Math.floor(exact) }; });
  let left = n - rows.reduce((a, r) => a + r.k, 0);
  rows.slice().sort((a, b) => b.rem - a.rem).forEach((r) => { if (left > 0) { r.k++; left--; } });
  const out = [];
  for (const r of rows) for (let i = 0; i < r.k; i++) out.push({ color: r.x.p.color, shape: r.x.p.shape || 'sphere' });
  return out;
}
