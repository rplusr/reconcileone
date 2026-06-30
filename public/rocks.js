(function () {
  // ── Seeded RNG ──────────────────────────────────────────────────────────────
  function seededRand(seed) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  // ── Rock sprite generation ───────────────────────────────────────────────────
  function makeRockTemplate(seed, baseW, baseH) {
    const rand  = seededRand(seed);
    const sides = 7 + Math.floor(rand() * 4);
    const cx = baseW / 2, cy = baseH / 2;
    const rx = baseW * 0.40, ry = baseH * 0.38;

    const vizVerts = [];
    for (let i = 0; i < sides; i++) {
      const angle  = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const jitter = 0.62 + rand() * 0.36;
      vizVerts.push({
        x: cx + Math.cos(angle) * rx * jitter,
        y: cy + Math.sin(angle) * ry * jitter
      });
    }

    const oc     = document.createElement('canvas');
    oc.width     = baseW;
    oc.height    = baseH;
    const gc     = oc.getContext('2d');
    const lum    = 148 + Math.floor(rand() * 52);
    const warm   = Math.floor(rand() * 14);

    // Drop shadow
    gc.save();
    gc.translate(4, 5);
    gc.beginPath();
    gc.moveTo(vizVerts[0].x, vizVerts[0].y);
    vizVerts.forEach(v => gc.lineTo(v.x, v.y));
    gc.closePath();
    gc.fillStyle = 'rgba(0,0,0,0.13)';
    gc.fill();
    gc.restore();

    // Rock fill with radial gradient
    gc.beginPath();
    gc.moveTo(vizVerts[0].x, vizVerts[0].y);
    vizVerts.forEach(v => gc.lineTo(v.x, v.y));
    gc.closePath();
    const grd = gc.createRadialGradient(
      cx - rx * 0.22, cy - ry * 0.22, rx * 0.04,
      cx, cy, Math.max(rx, ry)
    );
    grd.addColorStop(0,    `rgb(${lum+30+warm},${lum+28},${lum+20})`);
    grd.addColorStop(0.55, `rgb(${lum+warm},${lum},${lum-warm})`);
    grd.addColorStop(1,    `rgb(${lum-38+warm},${lum-38},${lum-42})`);
    gc.fillStyle = grd;
    gc.fill();

    gc.strokeStyle = 'rgba(0,0,0,0.20)';
    gc.lineWidth   = 1.4;
    gc.stroke();

    // Crack lines
    for (let c = 0; c < 2; c++) {
      const sx = cx + (rand()-0.5)*rx*0.9, sy = cy + (rand()-0.5)*ry*0.9;
      const ex = sx + (rand()-0.5)*rx*0.55, ey = sy + (rand()-0.5)*ry*0.55;
      gc.beginPath(); gc.moveTo(sx, sy); gc.lineTo(ex, ey);
      gc.strokeStyle = `rgba(0,0,0,${0.05 + rand()*0.07})`;
      gc.lineWidth   = 0.7;
      gc.stroke();
    }

    // Highlight sliver
    gc.beginPath();
    gc.moveTo(vizVerts[1].x, vizVerts[1].y);
    gc.lineTo(vizVerts[2].x, vizVerts[2].y);
    gc.strokeStyle = 'rgba(255,255,255,0.22)';
    gc.lineWidth   = 1.8;
    gc.stroke();

    const img = new Image();
    img.src = oc.toDataURL('image/png');

    return { img, physRadius: (rx + ry) / 2 * 0.88, sides, w: baseW, h: baseH };
  }

  const TEMPLATES = [
    [90,68],[76,58],[108,80],[64,52],
    [96,72],[82,62],[114,84],[70,54]
  ].map(([w, h], i) => makeRockTemplate(i * 37 + 11, w, h));

  // ── Matter.js setup ──────────────────────────────────────────────────────────
  const { Engine, Runner, Bodies, Body, World, Mouse, MouseConstraint } = Matter;

  // Canvas — fills the container or the full window
  const canvas       = document.createElement('canvas');
  canvas.style.cssText = 'display:block;cursor:grab;';
  canvas.addEventListener('mousedown', () => canvas.style.cursor = 'grabbing');
  canvas.addEventListener('mouseup',   () => canvas.style.cursor = 'grab');

  const target = document.getElementById('rocks-container') || document.body;
  target.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function W() { return canvas.width; }
  function H() { return canvas.height; }

  function resize() {
    const rect      = target === document.body
      ? { width: window.innerWidth, height: window.innerHeight }
      : target.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
  }
  resize();

  const engine = Engine.create({ gravity: { y: 1.8 } });
  const world  = engine.world;

  let boundaries = [];
  function makeBoundaries() {
    if (boundaries.length) World.remove(world, boundaries);
    const t  = 80;
    boundaries = [
      Bodies.rectangle(W()/2,   H()+t/2, W()*4, t,   { isStatic: true }),
      Bodies.rectangle(-t/2,    H()/2,   t,   H()*4, { isStatic: true }),
      Bodies.rectangle(W()+t/2, H()/2,   t,   H()*4, { isStatic: true }),
    ];
    World.add(world, boundaries);
  }
  makeBoundaries();

  const mouse = Mouse.create(canvas);
  const mc    = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, damping: 0.1, render: { visible: false } }
  });
  World.add(world, mc);

  let rocks = [];

  function spawnRock(i) {
    const tpl  = TEMPLATES[i % TEMPLATES.length];
    const x    = W() * 0.1 + Math.random() * W() * 0.8;
    const body = Bodies.polygon(x, -tpl.h, tpl.sides, tpl.physRadius, {
      restitution: 0.18,
      friction:    0.65,
      frictionAir: 0.014,
      density:     0.004,
    });
    Body.setAngle(body, (Math.random()-0.5) * Math.PI);
    Body.setVelocity(body, { x: (Math.random()-0.5)*3, y: 1 });
    World.add(world, body);
    rocks.push({ body, tpl });
  }

  const ROCK_COUNT = 22;
  let dropped = 0;

  function dropNext() {
    if (dropped < ROCK_COUNT) {
      spawnRock(dropped++);
      setTimeout(dropNext, 140 + Math.random() * 180);
    }
  }

  Runner.run(Runner.create(), engine);

  function drawFrame() {
    ctx.clearRect(0, 0, W(), H());
    rocks.forEach(({ body, tpl }) => {
      const { x, y } = body.position;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(body.angle);
      ctx.drawImage(tpl.img, -tpl.w/2, -tpl.h/2, tpl.w, tpl.h);
      ctx.restore();
    });
    requestAnimationFrame(drawFrame);
  }

  setTimeout(() => { dropNext(); drawFrame(); }, 200);

  // Public reset
  window.rocksReset = function () {
    rocks.forEach(r => World.remove(world, r.body));
    rocks   = [];
    dropped = 0;
    setTimeout(dropNext, 100);
  };

  window.addEventListener('resize', () => {
    resize();
    makeBoundaries();
    Mouse.setOffset(mouse, { x: 0, y: 0 });
  });
})();
