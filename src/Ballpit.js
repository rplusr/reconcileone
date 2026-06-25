import {
  Vector3,
  MeshBasicMaterial,
  InstancedMesh,
  Timer,
  AmbientLight,
  PlaneGeometry,
  Scene,
  Object3D,
  SRGBColorSpace,
  MathUtils,
  Vector2,
  WebGLRenderer,
  PerspectiveCamera,
  CanvasTexture,
  ACESFilmicToneMapping,
  Plane,
  Raycaster
} from 'three';

// ─── Three.js bootstrap ───────────────────────────────────────────────────────

class ThreeApp {
  #opts;
  canvas;
  camera;
  cameraFov;
  cameraMaxAspect;
  scene;
  renderer;
  size = { width: 0, height: 0, wWidth: 0, wHeight: 0, ratio: 0, pixelRatio: 0 };
  onBeforeRender = () => {};
  onAfterRender = () => {};
  onAfterResize = () => {};
  #visible = false;
  #running = false;
  #raf;
  #timer = new Timer();
  #clock = { elapsed: 0, delta: 0 };
  #resizeDebounce;
  #intersectionObs;
  #resizeObs;

  constructor(opts) {
    this.#opts = opts;
    this.camera = new PerspectiveCamera();
    this.cameraFov = this.camera.fov;
    this.scene = new Scene();
    const canvas = opts.canvas ?? document.getElementById(opts.id);
    this.canvas = canvas;
    canvas.style.display = 'block';
    this.renderer = new WebGLRenderer({
      canvas,
      powerPreference: 'high-performance',
      antialias: true,
      alpha: true
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    window.addEventListener('resize', this.#onResize.bind(this));
    if (opts.size === 'parent' && canvas.parentNode) {
      this.#resizeObs = new ResizeObserver(this.#onResize.bind(this));
      this.#resizeObs.observe(canvas.parentNode);
    }
    this.#intersectionObs = new IntersectionObserver(entries => {
      this.#visible = entries[0].isIntersecting;
      this.#visible ? this.#start() : this.#stop();
    });
    this.#intersectionObs.observe(canvas);
    document.addEventListener('visibilitychange', () => {
      if (this.#visible) document.hidden ? this.#stop() : this.#start();
    });
    this.resize();
  }

  #onResize() {
    clearTimeout(this.#resizeDebounce);
    this.#resizeDebounce = setTimeout(() => this.resize(), 100);
  }

  resize() {
    const opts = this.#opts;
    let w, h;
    if (opts.size === 'parent' && this.canvas.parentNode) {
      w = this.canvas.parentNode.offsetWidth;
      h = this.canvas.parentNode.offsetHeight;
    } else {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    this.size.width = w;
    this.size.height = h;
    this.size.ratio = w / h;
    this.camera.aspect = w / h;
    if (this.cameraMaxAspect && this.camera.aspect > this.cameraMaxAspect) {
      const t = Math.tan(MathUtils.degToRad(this.cameraFov / 2)) / (this.camera.aspect / this.cameraMaxAspect);
      this.camera.fov = 2 * MathUtils.radToDeg(Math.atan(t));
    } else {
      this.camera.fov = this.cameraFov;
    }
    this.camera.updateProjectionMatrix();
    const fovRad = (this.camera.fov * Math.PI) / 180;
    this.size.wHeight = 2 * Math.tan(fovRad / 2) * this.camera.position.length();
    this.size.wWidth = this.size.wHeight * this.camera.aspect;
    this.renderer.setSize(w, h);
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.size.pixelRatio = dpr;
    this.onAfterResize(this.size);
  }

  #start() {
    if (this.#running) return;
    this.#running = true;
    this.#timer.reset();
    const animate = () => {
      this.#raf = requestAnimationFrame(animate);
      this.#timer.update();
      this.#clock.delta = this.#timer.getDelta();
      this.#clock.elapsed += this.#clock.delta;
      this.onBeforeRender(this.#clock);
      this.renderer.render(this.scene, this.camera);
      this.onAfterRender(this.#clock);
    };
    animate();
  }

  #stop() {
    if (!this.#running) return;
    cancelAnimationFrame(this.#raf);
    this.#running = false;
  }

  dispose() {
    window.removeEventListener('resize', this.#onResize.bind(this));
    this.#resizeObs?.disconnect();
    this.#intersectionObs?.disconnect();
    this.#stop();
    this.#timer.dispose();
    this.scene.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (obj.material) {
          Object.values(obj.material).forEach(v => v?.dispose?.());
          obj.material.dispose();
        }
      }
    });
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// ─── Pointer / touch tracker ──────────────────────────────────────────────────

const _trackers = new Map();
let _listenersActive = false;
const _mouse = new Vector2();

function createPointerTracker(domElement, callbacks) {
  const state = {
    position: new Vector2(),
    nPosition: new Vector2(),
    hover: false,
    touching: false,
    ...callbacks
  };
  _trackers.set(domElement, state);
  if (!_listenersActive) {
    document.body.addEventListener('pointermove', _onMove);
    document.body.addEventListener('pointerleave', _onLeave);
    document.body.addEventListener('touchstart', _onTouchStart, { passive: false });
    document.body.addEventListener('touchmove', _onTouchMove, { passive: false });
    document.body.addEventListener('touchend', _onTouchEnd, { passive: false });
    document.body.addEventListener('touchcancel', _onTouchEnd, { passive: false });
    _listenersActive = true;
  }
  return {
    ...state,
    dispose() {
      _trackers.delete(domElement);
      if (_trackers.size === 0) {
        document.body.removeEventListener('pointermove', _onMove);
        document.body.removeEventListener('pointerleave', _onLeave);
        document.body.removeEventListener('touchstart', _onTouchStart);
        document.body.removeEventListener('touchmove', _onTouchMove);
        document.body.removeEventListener('touchend', _onTouchEnd);
        document.body.removeEventListener('touchcancel', _onTouchEnd);
        _listenersActive = false;
      }
    }
  };
}

function _updateNPos(state, rect) {
  state.position.x = _mouse.x - rect.left;
  state.position.y = _mouse.y - rect.top;
  state.nPosition.x = (state.position.x / rect.width) * 2 - 1;
  state.nPosition.y = (-state.position.y / rect.height) * 2 + 1;
}
function _inRect(rect) {
  return _mouse.x >= rect.left && _mouse.x <= rect.left + rect.width &&
         _mouse.y >= rect.top  && _mouse.y <= rect.top  + rect.height;
}
function _onMove(e) {
  _mouse.set(e.clientX, e.clientY);
  for (const [el, s] of _trackers) {
    const r = el.getBoundingClientRect();
    _updateNPos(s, r);
    if (_inRect(r)) {
      if (!s.hover) { s.hover = true; s.onEnter?.(s); }
      s.onMove?.(s);
    } else if (s.hover && !s.touching) {
      s.hover = false; s.onLeave?.(s);
    }
  }
}
function _onLeave() {
  for (const s of _trackers.values()) {
    if (s.hover) { s.hover = false; s.onLeave?.(s); }
  }
}
function _onTouchStart(e) {
  if (!e.touches.length) return;
  e.preventDefault();
  _mouse.set(e.touches[0].clientX, e.touches[0].clientY);
  for (const [el, s] of _trackers) {
    const r = el.getBoundingClientRect();
    if (_inRect(r)) {
      s.touching = true; _updateNPos(s, r);
      if (!s.hover) { s.hover = true; s.onEnter?.(s); }
      s.onMove?.(s);
    }
  }
}
function _onTouchMove(e) {
  if (!e.touches.length) return;
  e.preventDefault();
  _mouse.set(e.touches[0].clientX, e.touches[0].clientY);
  for (const [el, s] of _trackers) {
    const r = el.getBoundingClientRect();
    _updateNPos(s, r);
    if (_inRect(r)) {
      if (!s.hover) { s.hover = true; s.touching = true; s.onEnter?.(s); }
      s.onMove?.(s);
    } else if (s.hover && s.touching) {
      s.onMove?.(s);
    }
  }
}
function _onTouchEnd() {
  for (const s of _trackers.values()) {
    if (s.touching) { s.touching = false; if (s.hover) { s.hover = false; s.onLeave?.(s); } }
  }
}

// ─── Physics ──────────────────────────────────────────────────────────────────

const { randFloat, randFloatSpread } = MathUtils;
const _pa = new Vector3(), _pb = new Vector3(), _va = new Vector3(), _vb = new Vector3();
const _sep = new Vector3(), _imp = new Vector3(), _impB = new Vector3();
const _sphere0 = new Vector3();

class Physics {
  constructor(cfg) {
    this.cfg = cfg;
    this.pos = new Float32Array(3 * cfg.count).fill(0);
    this.vel = new Float32Array(3 * cfg.count).fill(0);
    this.sizes = new Float32Array(cfg.count).fill(1);
    this.center = new Vector3();
    this.#init();
    this.resetSizes();
  }

  #init() {
    const { cfg, pos } = this;
    this.center.toArray(pos, 0);
    for (let i = 1; i < cfg.count; i++) {
      const b = 3 * i;
      pos[b]     = randFloatSpread(2 * cfg.maxX);
      pos[b + 1] = randFloatSpread(2 * cfg.maxY);
      pos[b + 2] = randFloatSpread(2 * cfg.maxZ);
    }
  }

  resetSizes() {
    const { cfg, sizes } = this;
    sizes[0] = cfg.size0;
    for (let i = 1; i < cfg.count; i++) sizes[i] = randFloat(cfg.minSize, cfg.maxSize);
  }

  update(clock) {
    const { cfg, center: c, pos, sizes, vel } = this;
    let start = 0;
    if (cfg.controlSphere0) {
      start = 1;
      _pa.fromArray(pos, 0).lerp(c, 0.1).toArray(pos, 0);
      _va.set(0, 0, 0).toArray(vel, 0);
    }
    for (let i = start; i < cfg.count; i++) {
      const b = 3 * i;
      _pa.fromArray(pos, b);
      _va.fromArray(vel, b);
      _va.y -= clock.delta * cfg.gravity * sizes[i];
      _va.multiplyScalar(cfg.friction).clampLength(0, cfg.maxVelocity);
      _pa.add(_va).toArray(pos, b);
      _va.toArray(vel, b);
    }
    if (cfg.controlSphere0) _sphere0.fromArray(pos, 0);
    for (let i = start; i < cfg.count; i++) {
      const b = 3 * i;
      _pa.fromArray(pos, b);
      _va.fromArray(vel, b);
      const ri = sizes[i];
      for (let j = i + 1; j < cfg.count; j++) {
        const bj = 3 * j;
        _pb.fromArray(pos, bj);
        _vb.fromArray(vel, bj);
        const rj = sizes[j];
        _sep.copy(_pb).sub(_pa);
        const dist = _sep.length();
        const sum = ri + rj;
        if (dist < sum) {
          const overlap = sum - dist;
          _imp.copy(_sep).normalize().multiplyScalar(0.5 * overlap);
          _impB.copy(_imp).multiplyScalar(Math.max(_va.length(), 1));
          _pa.sub(_imp); _va.sub(_impB); _pa.toArray(pos, b); _va.toArray(vel, b);
          _pb.add(_imp);
          _vb.add(_imp.multiplyScalar(Math.max(_vb.length(), 1)));
          _pb.toArray(pos, bj); _vb.toArray(vel, bj);
        }
      }
      if (cfg.controlSphere0) {
        _sep.copy(_sphere0).sub(_pa);
        const dist = _sep.length();
        const sum0 = ri + sizes[0];
        if (dist < sum0) {
          const diff = sum0 - dist;
          _imp.copy(_sep.normalize()).multiplyScalar(diff);
          _pa.sub(_imp); _va.sub(_imp.multiplyScalar(Math.max(_va.length(), 2)));
        }
      }
      if (Math.abs(_pa.x) + ri > cfg.maxX) { _pa.x = Math.sign(_pa.x) * (cfg.maxX - ri); _va.x *= -cfg.wallBounce; }
      if (cfg.gravity === 0) {
        if (Math.abs(_pa.y) + ri > cfg.maxY) { _pa.y = Math.sign(_pa.y) * (cfg.maxY - ri); _va.y *= -cfg.wallBounce; }
      } else if (_pa.y - ri < -cfg.maxY) { _pa.y = -cfg.maxY + ri; _va.y *= -cfg.wallBounce; }
      const maxZ = Math.max(cfg.maxZ, cfg.maxSize);
      if (Math.abs(_pa.z) + ri > maxZ) { _pa.z = Math.sign(_pa.z) * (cfg.maxZ - ri); _va.z *= -cfg.wallBounce; }
      _pa.toArray(pos, b); _va.toArray(vel, b);
    }
  }
}

// ─── SVG → canvas texture ─────────────────────────────────────────────────────

function buildHeadTexture(svgUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // draw SVG centred/fitted inside a circle clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
      resolve(new CanvasTexture(canvas));
    };
    img.src = svgUrl;
  });
}

// ─── Head sprite mesh ─────────────────────────────────────────────────────────

const DEFAULT_CFG = {
  count: 80,
  minSize: 0.5,
  maxSize: 1.2,
  size0: 1.2,
  gravity: 0.5,
  friction: 0.9975,
  wallBounce: 0.95,
  maxVelocity: 0.15,
  maxX: 5,
  maxY: 5,
  maxZ: 0,       // keep flat; no z spread for sprites
  controlSphere0: false,
  followCursor: true
};

const _dummy = new Object3D();

class HeadMesh extends InstancedMesh {
  constructor(texture, cfg) {
    const geom = new PlaneGeometry(1, 1);
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.05, depthWrite: false });
    super(geom, mat, cfg.count);
    this.cfg = cfg;
    this.physics = new Physics(cfg);
    this.frustumCulled = false;
    // dim ambient so it doesn't wash out the texture
    this.ambientLight = new AmbientLight(0xffffff, 0.5);
    this.add(this.ambientLight);
  }

  update(clock, cameraQuaternion) {
    this.physics.update(clock);
    for (let i = 0; i < this.count; i++) {
      _dummy.position.fromArray(this.physics.pos, 3 * i);
      _dummy.quaternion.copy(cameraQuaternion); // billboard: face camera
      const s = this.physics.sizes[i];
      if (i === 0 && !this.cfg.followCursor) {
        _dummy.scale.setScalar(0);
      } else {
        _dummy.scale.set(s * 1.3, s * 1.3, 1); // slightly wider than tall for face shape
      }
      _dummy.updateMatrix();
      this.setMatrixAt(i, _dummy.matrix);
    }
    this.instanceMatrix.needsUpdate = true;
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

export function createBallpit(canvas, userCfg = {}) {
  const cfg = { ...DEFAULT_CFG, ...userCfg };
  const app = new ThreeApp({ canvas, size: 'parent' });

  app.camera.position.set(0, 0, 20);
  app.camera.lookAt(0, 0, 0);
  app.cameraMaxAspect = 1.5;
  app.resize();

  // resolve SVG path relative to this script
  const svgUrl = new URL('../public/head.svg', import.meta.url).href;

  let heads = null;
  let paused = false;

  buildHeadTexture(svgUrl).then(tex => {
    heads = new HeadMesh(tex, cfg);
    app.scene.add(heads);
  });

  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';

  const raycaster = new Raycaster();
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const hitPoint = new Vector3();

  const pointer = createPointerTracker(canvas, {
    onMove(s) {
      if (!heads) return;
      raycaster.setFromCamera(s.nPosition, app.camera);
      app.camera.getWorldDirection(plane.normal);
      raycaster.ray.intersectPlane(plane, hitPoint);
      heads.physics.center.copy(hitPoint);
      heads.cfg.controlSphere0 = true;
    },
    onLeave() {
      if (heads) heads.cfg.controlSphere0 = false;
    }
  });

  app.onBeforeRender = clock => {
    if (!heads || paused) return;
    heads.update(clock, app.camera.quaternion);
  };

  app.onAfterResize = size => {
    if (!heads) return;
    heads.cfg.maxX = size.wWidth / 2;
    heads.cfg.maxY = size.wHeight / 2;
  };

  return {
    app,
    get heads() { return heads; },
    togglePause() { paused = !paused; },
    dispose() { pointer.dispose(); app.dispose(); }
  };
}
