'use strict';

// Фоновая сцена: два человечка играют в футбол. Время от времени один бьёт
// «через себя», мяч летит в зрителя и разбивает экран. Логика лабораторной в app.js.
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const FIRST_KICK = 5;        // секунд до первого удара «через себя»
  const ROLL = 1.3;            // затухание скорости мяча при качении, 1/с

  // ---------- Утилиты ----------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const chance = (p) => Math.random() < p;

  function makeCanvas(z) {
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:${z}`;
    document.body.append(c);
    return c;
  }

  const field = makeCanvas(-1);      // поле и игроки — под страницей
  const glass = makeCanvas(1000);    // мяч у экрана и трещины — поверх страницы
  const fctx = field.getContext('2d');
  const gctx = glass.getContext('2d');
  const backdrop = document.createElement('canvas');
  const page = document.querySelector('.container');

  let W, H, dpr, S, R, G, HORIZON, GRAV, MIN_X, MAX_X;
  let clock, players, ball, ev, nextBig, cracks, debris, fly, shake, flash;

  // ---------- Мяч: геометрия (усечённый икосаэдр) ----------
  const PHI = (1 + Math.sqrt(5)) / 2;
  const PATCHES = [];
  for (const a of [-1, 1]) {
    for (const b of [-PHI, PHI]) {
      for (const v of [[0, a, b], [a, b, 0], [b, 0, a]]) {
        const l = Math.hypot(v[0], v[1], v[2]);
        PATCHES.push(buildPatch(v.map((x) => x / l)));
      }
    }
  }

  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function onSphere(c, d, ang) {
    return norm([0, 1, 2].map((i) => c[i] * Math.cos(ang) + d[i] * Math.sin(ang)));
  }

  // Чёрный пятиугольник вокруг вершины c и «швы», уходящие от его углов
  function buildPatch(c) {
    const ref = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(c, ref));
    const w = cross(c, u);
    const rho = 0.36;
    const corners = [];
    const seams = [];
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5;
      const d = [0, 1, 2].map((k) => u[k] * Math.cos(a) + w[k] * Math.sin(a));
      corners.push(onSphere(c, d, rho));
      seams.push(onSphere(c, d, rho + 0.2));
    }
    return { c, corners, seams };
  }

  function rot(v, ax, ay, az) {
    let [x, y, z] = v;
    let cs = Math.cos(ax), sn = Math.sin(ax), t = y * cs - z * sn;
    z = y * sn + z * cs; y = t;
    cs = Math.cos(ay); sn = Math.sin(ay); t = x * cs + z * sn;
    z = -x * sn + z * cs; x = t;
    cs = Math.cos(az); sn = Math.sin(az); t = x * cs - y * sn;
    y = x * sn + y * cs; x = t;
    return [x, y, z];
  }

  function drawBall(c, x, y, r, b) {
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.clip();
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.65, '#eceff5');
    g.addColorStop(1, '#b4bccb');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);

    const project = (v) => {
      const p = rot(v, b.ax, b.ay, b.az);
      let px = p[0], py = p[1];
      if (p[2] < 0) { const l = Math.hypot(px, py) || 1; px /= l; py /= l; }
      return [x + px * r, y + py * r];
    };
    c.lineWidth = Math.max(1, r * 0.035);
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(40,48,62,.4)';
    c.fillStyle = '#262c3a';
    for (const patch of PATCHES) {
      if (rot(patch.c, b.ax, b.ay, b.az)[2] < 0.02) continue;
      c.beginPath();
      patch.corners.forEach((v, i) => {
        const p = project(v);
        if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]);
      });
      c.closePath();
      c.fill();
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const p = project(patch.corners[i]);
        const q = project(patch.seams[i]);
        c.moveTo(p[0], p[1]);
        c.lineTo(q[0], q[1]);
      }
      c.stroke();
    }
    const shade = c.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.45, x, y, r);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.32)');
    c.fillStyle = shade;
    c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,.3)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.stroke();
  }

  // ---------- Фон: небо, трибуны, газон ----------
  function drawBackdrop() {
    backdrop.width = Math.round(W * dpr);
    backdrop.height = Math.round(H * dpr);
    const c = backdrop.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sky = c.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#cfdcff');
    sky.addColorStop(1, '#f6e9f3');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, HORIZON + 1);

    const standH = H * 0.07;
    c.fillStyle = '#8d95b3';
    c.fillRect(0, HORIZON - standH, W, standH);
    for (let i = 0; i < (W * standH) / 55; i++) {
      c.fillStyle = `hsla(${Math.random() * 360},55%,62%,.8)`;
      c.fillRect(Math.random() * W, HORIZON - standH + Math.random() * (standH - 3), 3, 3);
    }
    c.fillStyle = '#6f7798';
    c.fillRect(0, HORIZON - standH * 0.14, W, standH * 0.14);

    const n = 14;
    for (let i = 0; i < n; i++) {
      const y0 = HORIZON + (H - HORIZON) * Math.pow(i / n, 1.7);
      const y1 = HORIZON + (H - HORIZON) * Math.pow((i + 1) / n, 1.7);
      c.fillStyle = i % 2 ? '#52b25a' : '#49a551';
      c.fillRect(0, y0, W, y1 - y0 + 1);
    }
    c.strokeStyle = 'rgba(255,255,255,.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(W / 2, HORIZON + (H - HORIZON) * 0.55, W * 0.17, (H - HORIZON) * 0.2, 0, 0, TAU);
    c.moveTo(W / 2, HORIZON);
    c.lineTo(W / 2, H);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.1)';
    c.fillRect(0, 0, W, H);
  }

  // ---------- Человечек: скелет и позы ----------
  const POSE_FIELDS = ['torso', 'tF', 'kF', 'tB', 'kB', 'aF', 'eF', 'aB', 'eB', 'lift'];
  const KIT = [
    { shirt: '#d9453d', shirtD: '#a8322c', shorts: '#ffffff', shortsD: '#cfd3dc' },
    { shirt: '#2f6fe0', shirtD: '#2352ad', shorts: '#1b2a52', shortsD: '#141f3d' }
  ];

  // Углы: бёдра, голени и руки — от «вниз» вперёд (0 — вниз, π/2 — вперёд, π — вверх);
  // torso — наклон от вертикали (минус — назад); k* и e* — сгиб колена и локтя.
  function lerpPose(a, b, t) {
    const out = {};
    for (const f of POSE_FIELDS) out[f] = lerp(a[f], b[f], t);
    return out;
  }

  function idlePose(p) {
    const br = Math.sin(clock * 2 + p.i) * 0.01;
    return { torso: 0.03 + br, tF: 0.1, kF: 0.15, tB: -0.06, kB: 0.12, aF: 0.12, eF: 0.35, aB: -0.12, eB: 0.35, lift: 0 };
  }

  function walkPose(p) {
    const idle = idlePose(p);
    const sp = Math.abs(p.vx) / S;
    const m = clamp(sp / 0.4, 0, 1);
    if (m === 0) return idle;
    const f = Math.min(sp / 3, 1);
    const A = 0.35 + 0.22 * Math.min(sp, 3.5);
    const s = Math.sin(p.phase);
    const c = Math.cos(p.phase);
    const K = 0.4 + 0.9 * f;
    const run = {
      torso: 0.04 + 0.12 * f,
      tF: A * s, kF: 0.15 + K * Math.max(0, c),
      tB: -A * s, kB: 0.15 + K * Math.max(0, -c),
      aF: -0.85 * A * s + 0.1, eF: 0.5 + 0.7 * f,
      aB: 0.85 * A * s + 0.1, eB: 0.5 + 0.7 * f,
      lift: 0.05 * S * Math.abs(s) * f
    };
    return lerpPose(idle, run, m);
  }

  // Обычный удар: замах — удар — возврат
  const SWING_TIME = 0.38;
  const SWING_CONTACT = 0.19;
  function swingPose(sw) {
    const s = sw.t / SWING_TIME;
    const back = smooth(s / 0.4);
    const fwd = smooth((s - 0.4) / 0.2);
    const rec = smooth((s - 0.65) / 0.35);
    const pw = sw.kind === 'ground' ? 1 : 1.35;
    const mix = (b, f, base) => lerp(lerp(lerp(base, b, back), f, fwd), base, rec);
    return {
      torso: mix(-0.12, 0.28 * pw, 0.03), tF: mix(-0.9, 1.05 * pw, 0.1), kF: mix(1.5, 0.12, 0.2),
      tB: mix(0.12, 0.05, -0.06), kB: mix(0.3, 0.25, 0.12),
      aF: mix(0.5, -0.4, 0.12), eF: 0.5, aB: mix(-0.6, 0.7, -0.12), eB: 0.5, lift: 0
    };
  }

  // Удар «через себя» (бисиклета). Время a — от момента касания мяча (a = 0).
  const KEYS = {
    torso: [[-0.6, 0.03], [-0.42, -0.05], [-0.28, -0.5], [-0.12, -1.05], [0, -1.45], [0.18, -1.65], [0.45, -1.6], [0.95, -1.6], [1.4, -0.9], [1.85, 0.03]],
    tF: [[-0.6, 0.15], [-0.42, 0.4], [-0.28, 0.9], [-0.12, 1.6], [0, 2.35], [0.16, 2.7], [0.4, 2.0], [0.95, 1.57], [1.4, 0.8], [1.85, 0.1]],
    kF: [[-0.6, 0.2], [-0.42, 0.9], [-0.28, 1.5], [-0.12, 1.3], [0, 0.2], [0.16, 0.15], [0.4, 0.5], [0.95, 0.25], [1.4, 0.5], [1.85, 0.15]],
    tB: [[-0.6, -0.1], [-0.42, 0.2], [-0.28, 0.5], [-0.12, 0.9], [0, 1.2], [0.16, 1.5], [0.4, 1.55], [0.95, 1.57], [1.4, 0.7], [1.85, -0.05]],
    kB: [[-0.6, 0.15], [-0.42, 0.8], [-0.28, 1.2], [-0.12, 1.5], [0, 1.3], [0.16, 0.9], [0.4, 0.3], [0.95, 0.15], [1.4, 0.4], [1.85, 0.12]],
    aF: [[-0.6, 0.3], [-0.42, -0.2], [-0.28, -1.2], [-0.12, -1.6], [0, -1.9], [0.18, -2.3], [0.45, -2.0], [0.95, -1.7], [1.4, -0.6], [1.85, 0.12]],
    eF: [[-0.6, 0.4], [0.45, 0.2], [1.85, 0.4]],
    aB: [[-0.6, -0.3], [-0.42, 0.3], [-0.28, 1.1], [-0.12, 1.6], [0, 1.9], [0.18, 1.6], [0.45, 1.2], [0.95, 0.9], [1.4, 0.3], [1.85, -0.12]],
    eB: [[-0.6, 0.4], [0.45, 0.3], [1.85, 0.4]]
  };
  const KEY_START = -0.6;
  const KEY_END = 1.85;

  // Кубический сплайн по ключевым точкам [время, значение]
  function track(pts, t) {
    const n = pts.length;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 1;
    while (pts[i][0] < t) i++;
    const [t0, v0] = pts[i - 1];
    const [t1, v1] = pts[i];
    const slope = (j) => {
      const a = pts[Math.max(0, j - 1)];
      const b = pts[Math.min(n - 1, j + 1)];
      return (b[1] - a[1]) / (b[0] - a[0] || 1);
    };
    const h = t1 - t0;
    const s = (t - t0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * slope(i - 1) +
      (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * slope(i);
  }

  function overheadPose(a) {
    const pose = {};
    for (const f of Object.keys(KEYS)) pose[f] = track(KEYS[f], a);
    const u = (a + 0.38) / 0.84;               // прыжок: от -0.38 до +0.46 с
    pose.lift = u > 0 && u < 1 ? 4 * u * (1 - u) * 0.4 * S : 0;
    return pose;
  }

  function poseOf(p) {
    if (p.mode === 'swing') return swingPose(p.swing);
    if (p.mode === 'overhead' && p.anim.a >= KEY_START) return overheadPose(p.anim.a);
    return walkPose(p);
  }

  // Координаты суставов относительно таза (x вперёд, y вниз) и самая низкая точка тела
  function layout(pose) {
    const L = 0.23 * S, T = 0.3 * S, A = 0.15 * S, HR = 0.075 * S;
    const seg = (o, a, l) => [o[0] + Math.sin(a) * l, o[1] + Math.cos(a) * l];
    const up = [Math.sin(pose.torso), -Math.cos(pose.torso)];
    const hip = [0, 0];
    const sh = [up[0] * T * 0.92, up[1] * T * 0.92];
    const head = [up[0] * (T + HR * 1.1), up[1] * (T + HR * 1.1)];
    const kneeF = seg(hip, pose.tF, L);
    const footF = seg(kneeF, pose.tF - pose.kF, L);
    const kneeB = seg(hip, pose.tB, L);
    const footB = seg(kneeB, pose.tB - pose.kB, L);
    const elbF = seg(sh, pose.aF, A);
    const handF = seg(elbF, pose.aF + pose.eF, A);
    const elbB = seg(sh, pose.aB, A);
    const handB = seg(elbB, pose.aB + pose.eB, A);
    const toe = (foot, a) => [foot[0] + Math.cos(a) * 0.09 * S, foot[1] - Math.sin(a) * 0.09 * S];
    const toeF = toe(footF, pose.tF - pose.kF);
    const toeB = toe(footB, pose.tB - pose.kB);
    const low = Math.max(
      toeF[1] + 0.025 * S, toeB[1] + 0.025 * S, footF[1] + 0.03 * S, footB[1] + 0.03 * S,
      kneeF[1] + 0.04 * S, kneeB[1] + 0.04 * S, handF[1] + 0.025 * S, handB[1] + 0.025 * S,
      sh[1] + 0.085 * S, 0.085 * S, head[1] + HR
    );
    const xs = [hip[0], sh[0], head[0] - HR, head[0] + HR, toeF[0], toeB[0], handF[0], handB[0]];
    return {
      kneeF, footF, toeF, kneeB, footB, toeB, elbF, handF, elbB, handB, sh, head, up, low, HR,
      minX: Math.min(...xs), maxX: Math.max(...xs)
    };
  }

  function drawPlayer(c, p) {
    const pose = p.pose;
    const J = layout(pose);
    const hipY = G - pose.lift - J.low;
    const kit = KIT[p.i];
    const skin = '#f0c7a0', skinD = '#d4a982', boots = '#1c1f26';

    const air = 1 - clamp(pose.lift / (0.8 * S), 0, 1) * 0.7;
    c.fillStyle = `rgba(20,30,20,${0.25 * air})`;
    c.beginPath();
    c.ellipse(p.x + (p.dir * (J.minX + J.maxX)) / 2, G + 3, (J.maxX - J.minX) / 2 + 0.1 * S, 0.05 * S, 0, 0, TAU);
    c.fill();

    c.save();
    c.translate(p.x, hipY);
    c.scale(p.dir, 1);
    c.lineCap = 'round';
    const line = (a, b, w, col) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    };
    const mid = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    const hip = [0, 0];
    const leg = (knee, foot, toe, shorts, sock, bare) => {
      const cut = mid(hip, knee, 0.62);
      line(hip, cut, 0.105 * S, shorts);
      line(cut, knee, 0.075 * S, bare);
      line(knee, foot, 0.07 * S, sock);
      line(foot, toe, 0.05 * S, boots);
    };
    const arm = (sh, elb, hand, sleeve, bare) => {
      line(sh, elb, 0.058 * S, sleeve);
      line(elb, hand, 0.046 * S, bare);
    };

    leg(J.kneeB, J.footB, J.toeB, kit.shortsD, kit.shirtD, skinD);
    arm(J.sh, J.elbB, J.handB, kit.shirtD, skinD);

    line(hip, J.sh, 0.17 * S, kit.shirt);
    line(hip, [J.up[0] * 0.06 * S, J.up[1] * 0.06 * S], 0.17 * S, kit.shorts);
    const fwd = [Math.cos(pose.torso), Math.sin(pose.torso)];
    c.fillStyle = '#2b2118';
    c.beginPath();
    c.arc(J.head[0], J.head[1], J.HR * 1.05, 0, TAU);
    c.fill();
    c.fillStyle = skin;
    c.beginPath();
    c.arc(J.head[0] + fwd[0] * J.HR * 0.22, J.head[1] + fwd[1] * J.HR * 0.22, J.HR * 0.93, 0, TAU);
    c.fill();
    c.fillStyle = '#2b2118';
    c.beginPath();
    c.arc(J.head[0] + fwd[0] * J.HR * 0.6 + J.up[0] * J.HR * 0.12, J.head[1] + fwd[1] * J.HR * 0.6 + J.up[1] * J.HR * 0.12, J.HR * 0.1, 0, TAU);
    c.fill();

    leg(J.kneeF, J.footF, J.toeF, kit.shorts, kit.shirt, skin);
    arm(J.sh, J.elbF, J.handF, kit.shirt, skin);
    c.restore();
    return { J, hipY };
  }

  // ---------- Мяч: физика ----------
  function newBall(x, h, vx) {
    return { state: 'free', x, h, vx, vh: 0, ax: rand(0, TAU), ay: rand(0, TAU), az: 0, sx: 0, sy: 0 };
  }

  function stepBall(b, dt) {
    b.vh -= GRAV * dt;
    b.x += b.vx * dt;
    b.h += b.vh * dt;
    if (b.h < R) {
      b.h = R;
      if (b.vh < -60) {
        b.vh = -b.vh * 0.62;
        b.vx *= 0.92;
      } else {
        b.vh = 0;
      }
    }
    if (b.h <= R + 0.5) b.vx *= Math.exp(-ROLL * dt);
    if (b.x < R && b.vx < 0) { b.x = R; b.vx = -b.vx * 0.6; }
    if (b.x > W - R && b.vx > 0) { b.x = W - R; b.vx = -b.vx * 0.6; }
  }

  function stepBallVisible(dt) {
    const n = Math.ceil(dt * 120);
    for (let i = 0; i < n; i++) stepBall(ball, dt / n);
    if (ball.h <= R + 0.5) ball.az += (ball.vx / R) * dt;
    else ball.az += ball.sy * dt;
    ball.ax += ball.sx * dt;
    ball.ay += ball.sx * 0.4 * dt;
  }

  // Где можно перехватить мяч: первая точка траектории, до которой игрок успевает добежать
  function interceptX(p) {
    const s = { x: ball.x, h: ball.h, vx: ball.vx, vh: ball.vh };
    const step = 1 / 30;
    for (let i = 1; i <= 150; i++) {
      stepBall(s, step);
      if (s.h < 0.4 * S && s.vh <= 0 && Math.abs(s.x - p.x) <= 3.6 * S * i * step + 0.3 * S) return s.x;
    }
    return s.x;
  }

  // ---------- Игроки: поведение ----------
  function other(p) { return players[1 - p.i]; }

  function moveTo(p, tx, vmax, dt) {
    const want = clamp((tx - p.x) * 4, -vmax, vmax);
    const a = 16 * S * dt;
    p.vx += clamp(want - p.vx, -a, a);
  }

  function pickHome(p) {
    const o = other(p);
    for (let k = 0; k < 20; k++) {
      const x = rand(MIN_X, MAX_X);
      if (Math.abs(x - o.home) > 0.3 * (MAX_X - MIN_X)) { p.home = x; break; }
    }
    p.homeT = rand(2.5, 5);
  }

  function glueBall(p, dt, ahead) {
    const tx = p.x + p.dir * ahead * S;
    ball.x += (tx - ball.x) * clamp(12 * dt, 0, 1);
    ball.vx = p.vx;
  }

  function startSwing(p, kind) {
    p.mode = 'swing';
    p.swing = { t: 0, kind, done: false };
  }

  function decide(p) {
    const o = other(p);
    const d = Math.abs(o.x - p.x);
    const mid = (MIN_X + MAX_X) / 2;
    const r = Math.random();
    if (d < 1.4 * S || r < 0.2) {
      let dir = Math.sign(p.x - o.x) || 1;
      if (p.x + dir * 1.5 * S < MIN_X || p.x + dir * 1.5 * S > MAX_X) dir = Math.sign(mid - p.x) || 1;
      p.mode = 'dribble';
      p.drib = { t: 0, dur: rand(0.9, 1.8), dir };
      return;
    }
    p.dir = Math.sign(o.x - p.x) || p.dir;
    startSwing(p, r < 0.55 && d > 2 * S ? 'lob' : 'ground');
  }

  function applyKick(p, kind) {
    const o = other(p);
    const dir = p.dir;
    ball.x = p.x + dir * 0.34 * S;
    const bx = ball.x;
    ball.sx = rand(-6, 6);
    ball.sy = rand(-4, 4);
    if (kind === 'ground') {
      let dist = Math.abs(o.x - bx) * rand(0.9, 1.5);
      dist = Math.min(dist, dir > 0 ? W * 0.97 - bx : bx - W * 0.03);
      ball.vx = dir * dist * ROLL;
      ball.vh = rand(0, 0.5 * S);
    } else if (kind === 'lob') {
      const tf = rand(0.95, 1.25);
      const tx = clamp(o.x + rand(-0.2, 0.2) * S, W * 0.05, W * 0.95);
      ball.vx = (tx - bx) / tf;
      ball.vh = (R - ball.h + 0.5 * GRAV * tf * tf) / tf;
    } else {
      // навес на ногу партнёра: мяч должен прийти в точку удара ровно к моменту касания
      const K = ev.K;
      const tf = rand(1.0, 1.2);
      const t = overheadTarget(K);
      ball.vx = (t.x - bx) / tf;
      ball.vh = (t.h - ball.h + 0.5 * GRAV * tf * tf) / tf;
      K.mode = 'overhead';
      K.anim = { a: -tf, launched: false };
      ev.phase = 'air';
    }
  }

  function overheadTarget(K) {
    const pose = overheadPose(0);
    const J = layout(pose);
    const hipY = G - pose.lift - J.low;
    return { x: K.x + J.toeF[0] * K.dir, y: hipY + J.toeF[1], h: G - (hipY + J.toeF[1]) + R * 0.6 };
  }

  function updatePlayer(p, dt) {
    const o = other(p);
    switch (p.mode) {
      case 'free':
        p.homeT -= dt;
        if (p.homeT <= 0) pickHome(p);
        moveTo(p, p.home, 1.3 * S, dt);
        p.dir = Math.abs(p.vx) > 0.15 * S ? Math.sign(p.vx) : Math.sign(ball.x - p.x) || p.dir;
        break;

      case 'chase':
      case 'fetch': {
        p.chaseT += dt;
        moveTo(p, interceptX(p), 3.6 * S, dt);
        if (Math.abs(p.vx) > 0.15 * S) p.dir = Math.sign(p.vx);
        if (p.chaseT > 7) { ball.x = p.x + p.dir * 0.5 * S; ball.vx = 0; }
        if (Math.abs(ball.x - p.x) < 0.5 * S && ball.h < 0.5 * S && ball.vh < 80) {
          ball.vh = Math.min(ball.vh, 0) * 0.3;
          p.mode = p.mode === 'fetch' ? 'carry' : 'control';
          p.timer = rand(0.25, 0.8);
        }
        break;
      }

      case 'control':
        moveTo(p, p.x, S, dt);
        p.dir = Math.sign(o.x - p.x) || p.dir;
        glueBall(p, dt, 0.34);
        p.timer -= dt;
        if (p.timer <= 0) decide(p);
        break;

      case 'dribble': {
        const d = p.drib;
        d.t += dt;
        p.dir = d.dir;
        const blocked = (d.dir > 0 && p.x > MAX_X - 0.3 * S) || (d.dir < 0 && p.x < MIN_X + 0.3 * S);
        moveTo(p, p.x + d.dir * S, blocked ? 0 : 1.5 * S, dt);
        glueBall(p, dt, 0.4 + 0.1 * Math.sin(p.phase * 2));
        if (d.t > d.dur) { p.mode = 'control'; p.timer = 0.1; }
        break;
      }

      case 'swing': {
        const sw = p.swing;
        moveTo(p, p.x, S, dt);
        sw.t += dt;
        if (!sw.done && sw.t >= SWING_CONTACT) {
          sw.done = true;
          applyKick(p, sw.kind);
        }
        if (sw.t >= SWING_TIME) {
          p.mode = 'free';
          p.homeT = 0;
          if (sw.kind !== 'event') { o.mode = 'chase'; o.chaseT = 0; }
        }
        break;
      }

      case 'goto':
        moveTo(p, ev.kx, 1.8 * S, dt);
        if (Math.abs(p.vx) > 0.15 * S) p.dir = Math.sign(p.vx);
        if (Math.abs(p.x - ev.kx) < 6 && Math.abs(p.vx) < 0.15 * S) {
          p.x = ev.kx;
          p.vx = 0;
          p.dir = Math.sign(ev.qx - ev.kx);
          p.mode = 'ready';
        }
        break;

      case 'ready':
        moveTo(p, p.x, S, dt);
        break;

      case 'carry': {
        const toward = Math.sign(ev.kx - p.x) || p.dir;
        moveTo(p, ev.qx, 1.4 * S, dt);
        p.dir = Math.abs(p.x - ev.qx) < 0.6 * S ? toward : Math.sign(ev.qx - p.x) || p.dir;
        glueBall(p, dt, 0.34);
        if (Math.abs(p.x - ev.qx) < 8 && Math.abs(p.vx) < 0.2 * S && ev.K.mode === 'ready') {
          p.dir = toward;
          startSwing(p, 'event');
        }
        break;
      }

      case 'overhead': {
        const an = p.anim;
        p.vx = 0;
        an.a += dt;
        if (!an.launched && an.a >= 0) {
          an.launched = true;
          const t = overheadTarget(p);
          launch(t.x, t.y);
        }
        if (an.a > KEY_END) { p.mode = 'free'; p.homeT = 0; }
        break;
      }
    }
    if (p.mode !== 'overhead') p.x = clamp(p.x + p.vx * dt, MIN_X * 0.5, W - MIN_X * 0.5);
    p.phase += (6.5 * Math.abs(p.vx) / S) * dt;
  }

  // ---------- Удар «через себя» ----------
  function startEvent() {
    const k = chance(0.5) ? 0 : 1;
    const K = players[k];
    const Q = players[1 - k];
    const range = MAX_X - MIN_X;
    const kx = rand(MIN_X + 0.3 * range, MAX_X - 0.3 * range);
    const side = kx > (MIN_X + MAX_X) / 2 ? -1 : 1;
    ev = { phase: 'setup', K, Q, kx, qx: kx + side * rand(0.28, 0.4) * range, t: 0, wait: 0 };
    K.mode = 'goto';
    Q.mode = 'fetch';
    Q.chaseT = 0;
  }

  function updateEvent(dt) {
    if (!ev) return;
    ev.t += dt;
    if (ev.phase === 'setup' && ev.t > 16) {
      for (const p of players) { p.mode = 'free'; p.homeT = 0; }
      ev = null;
      nextBig = clock + 6;
    } else if (ev.phase === 'air' && !fly && ball.state === 'gone' && ev.K.mode !== 'overhead') {
      ev.wait += dt;
      if (ev.wait > 1) respawn();
    }
  }

  // Новый мяч падает сверху, ближайший игрок бежит к нему
  function respawn() {
    ball = newBall(rand(0.25, 0.75) * W, G + 80, rand(-60, 60));
    const near = Math.abs(players[0].x - ball.x) < Math.abs(players[1].x - ball.x) ? players[0] : players[1];
    near.mode = 'chase';
    near.chaseT = 0;
    ev = null;
    nextBig = clock + rand(14, 22);
  }

  // ---------- Полёт мяча в экран и разбитое стекло ----------
  function launch(sx, sy) {
    const r1 = Math.min(W, H) * rand(0.15, 0.24);
    fly = {
      phase: 'in', t: 0, D: rand(0.55, 0.85),
      sx, sy, r0: R, r1, r: R,
      ex: rand(0.2, 0.8) * W, ey: rand(0.22, 0.6) * H,
      arc: rand(0.04, 0.2) * H * (chance(0.5) ? 1 : -0.3), wob: rand(-0.12, 0.12) * W,
      x: sx, y: sy, trail: [],
      ax: ball.ax, ay: ball.ay, az: ball.az, sx2: rand(-9, 9), sy2: rand(-9, 9), sz2: rand(-12, 12)
    };
    ball.state = 'flying';
  }

  function updateFly(dt) {
    if (!fly) return;
    fly.t += dt;
    fly.ax += fly.sx2 * dt;
    fly.ay += fly.sy2 * dt;
    fly.az += fly.sz2 * dt;
    if (fly.phase === 'in') {
      const u = clamp(fly.t / fly.D, 0, 1);
      fly.r = 1 / lerp(1 / fly.r0, 1 / fly.r1, u);      // перспектива: радиус растёт как 1/расстояние
      const q = (fly.r - fly.r0) / (fly.r1 - fly.r0);
      fly.x = fly.sx + (fly.ex - fly.sx) * q + fly.wob * Math.sin(Math.PI * q);
      fly.y = fly.sy + (fly.ey - fly.sy) * q - fly.arc * Math.sin(Math.PI * q);
      fly.trail.push([fly.x, fly.y, fly.r]);
      if (fly.trail.length > 5) fly.trail.shift();
      if (u >= 1) {
        fly.phase = 'rebound';
        fly.rt = 0;
        fly.vx = rand(-150, 150);
        fly.vy = -rand(80, 260);
        impact(fly.x, fly.y, fly.r);
      }
    } else {
      fly.rt += dt;
      fly.vy += 1800 * dt;
      fly.x += fly.vx * dt;
      fly.y += fly.vy * dt;
      fly.r = fly.r1 * (1 - 0.5 * smooth(fly.rt / 0.7));
      if (fly.y - fly.r > H + 20) {
        fly = null;
        ball.state = 'gone';
      }
    }
  }

  function impact(x, y, r) {
    cracks.push(makeCrack(x, y, r));
    if (cracks.length > 3) cracks.shift();
    shake = { t: 0, dur: 0.6, amp: clamp(Math.min(W, H) * 0.02, 10, 22) };
    flash = 1;
    for (let i = 0; i < 46; i++) {
      const a = rand(0, TAU);
      const sp = rand(150, 900);
      debris.push({
        x: x + Math.cos(a) * r * rand(0, 0.5), y: y + Math.sin(a) * r * rand(0, 0.5),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, rot: rand(0, TAU), vr: rand(-12, 12),
        s: rand(3, 10), life: 0, shape: [rand(0.6, 1), rand(0.3, 0.7), rand(0.6, 1)]
      });
    }
  }

  function makeCrack(cx, cy, r) {
    const n = Math.round(rand(14, 22));
    const maxLen = Math.hypot(W, H) * rand(0.5, 0.8);
    const base = rand(0, TAU);
    const radii = [r * 0.45];
    while (radii[radii.length - 1] < maxLen) radii.push(radii[radii.length - 1] * rand(1.28, 1.5) + rand(2, 8));
    const rays = [];
    for (let k = 0; k < n; k++) {
      let a = base + (k + rand(-0.3, 0.3)) * TAU / n;
      const count = Math.max(3, Math.round(radii.length * rand(0.3, 1)));
      const pts = [];
      for (let j = 0; j < count; j++) {
        a += rand(-0.06, 0.06);
        const rr = radii[j] * rand(0.94, 1.06);
        pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: rr });
      }
      rays.push(pts);
    }
    const rings = radii.map((_, j) => j > 0 && chance(0.7));
    const cells = [];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const last = Math.min(rays[k].length, rays[k2].length) - 1;
      for (let j = 0; j < last; j++) {
        cells.push({
          k, k2, j,
          tint: chance(0.5) ? `rgba(255,255,255,${rand(0.02, 0.12) / (1 + 0.3 * j)})` : `rgba(0,0,0,${rand(0.02, 0.1) / (1 + 0.3 * j)})`,
          fall: j < 3 && chance(0.18), delay: rand(0.15, 0.6)
        });
      }
    }
    const specks = [];
    for (let i = 0; i < 36; i++) {
      const a = rand(0, TAU);
      const d = r * rand(0.2, 1.6);
      specks.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, rand(0.8, 2.2)]);
    }
    return { cx, cy, r, rays, rings, cells, specks, born: clock, maxLen: radii[radii.length - 1] };
  }

  function drawCrack(c, k) {
    const age = clock - k.born;
    const alpha = age < 8 ? 1 : 1 - (age - 8) / 2.5;
    if (alpha <= 0) return false;
    const D = k.maxLen * (1 - Math.pow(1 - clamp(age / 0.35, 0, 1), 3));
    c.save();
    c.globalAlpha = alpha;

    // осколки-ячейки между лучами
    for (const cell of k.cells) {
      const a = k.rays[cell.k][cell.j], b = k.rays[cell.k][cell.j + 1];
      const d = k.rays[cell.k2][cell.j + 1], e = k.rays[cell.k2][cell.j];
      if (b.r > D || d.r > D) continue;
      c.save();
      let fade = 1;
      if (cell.fall && age > cell.delay) {
        const tf = age - cell.delay;
        const mx = (a.x + b.x + d.x + e.x) / 4;
        const my = (a.y + b.y + d.y + e.y) / 4;
        c.fillStyle = 'rgba(0,0,0,.2)';
        c.beginPath();
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y);
        c.fill();
        fade = 1 - tf / 0.9;
        if (fade <= 0) { c.restore(); continue; }
        c.translate(mx, my + 1100 * tf * tf);
        c.rotate(tf * 2);
        c.translate(-mx, -my);
      }
      c.globalAlpha = alpha * fade;
      c.fillStyle = cell.fall ? 'rgba(255,255,255,.35)' : cell.tint;
      c.beginPath();
      c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y);
      c.fill();
      c.restore();
    }

    // трещины: лучи (три толщины) и кольца
    const buckets = [new Path2D(), new Path2D(), new Path2D()];
    for (const ray of k.rays) {
      let prev = { x: k.cx, y: k.cy, r: 0 };
      for (let j = 0; j < ray.length; j++) {
        const cur = ray[j];
        const path = buckets[j < 2 ? 0 : j < 5 ? 1 : 2];
        path.moveTo(prev.x, prev.y);
        if (cur.r <= D) {
          path.lineTo(cur.x, cur.y);
        } else {
          const t = (D - prev.r) / (cur.r - prev.r);
          if (t > 0) path.lineTo(lerp(prev.x, cur.x, t), lerp(prev.y, cur.y, t));
          break;
        }
        prev = cur;
      }
    }
    const ringPath = new Path2D();
    k.rings.forEach((on, j) => {
      if (!on) return;
      for (let i = 0; i < k.rays.length; i++) {
        const a = k.rays[i][j], b = k.rays[(i + 1) % k.rays.length][j];
        if (!a || !b || a.r > D || b.r > D) continue;
        ringPath.moveTo(a.x, a.y);
        ringPath.lineTo(b.x, b.y);
      }
    });
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.save();
    c.translate(0.9, 0.9);
    c.strokeStyle = 'rgba(0,0,0,.35)';
    [2.4, 1.6, 1].forEach((w, i) => { c.lineWidth = w; c.stroke(buckets[i]); });
    c.lineWidth = 1;
    c.stroke(ringPath);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.92)';
    [1.8, 1.2, 0.7].forEach((w, i) => { c.lineWidth = w; c.stroke(buckets[i]); });
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 0.8;
    c.stroke(ringPath);

    // место удара и мелкая крошка
    const spot = c.createRadialGradient(k.cx, k.cy, 0, k.cx, k.cy, k.r * 0.95);
    spot.addColorStop(0, 'rgba(255,255,255,.8)');
    spot.addColorStop(0.5, 'rgba(255,255,255,.28)');
    spot.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = spot;
    c.beginPath();
    c.arc(k.cx, k.cy, k.r * 0.95, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.85)';
    for (const s of k.specks) {
      if (Math.hypot(s[0] - k.cx, s[1] - k.cy) > D) continue;
      c.beginPath();
      c.arc(s[0], s[1], s[2], 0, TAU);
      c.fill();
    }
    c.restore();
    return true;
  }

  function updateDebris(dt) {
    for (const d of debris) {
      d.life += dt;
      d.vy += 1900 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
    }
    debris = debris.filter((d) => d.life < 1.4 && d.y < H + 40);
  }

  function drawDebris(c) {
    for (const d of debris) {
      c.save();
      c.translate(d.x, d.y);
      c.rotate(d.rot);
      c.globalAlpha = clamp(1.4 - d.life, 0, 1) * 0.85;
      c.fillStyle = 'rgba(235,245,255,.9)';
      c.strokeStyle = 'rgba(255,255,255,.95)';
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(d.s * d.shape[0], 0);
      c.lineTo(-d.s * d.shape[1], d.s * 0.7);
      c.lineTo(-d.s * d.shape[2] * 0.5, -d.s * 0.8);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  function applyShake(dt) {
    if (!shake) return;
    shake.t += dt;
    const k = 1 - shake.t / shake.dur;
    if (k <= 0) {
      shake = null;
      page.style.transform = '';
      field.style.transform = '';
      return;
    }
    const a = shake.amp * k * k;
    const move = `translate(${rand(-a, a)}px,${rand(-a, a)}px) rotate(${rand(-a, a) * 0.04}deg)`;
    page.style.transform = move;
    field.style.transform = `${move} scale(1.05)`;
  }

  // ---------- Кадр ----------
  function update(dt) {
    const free = players.every((p) => p.mode === 'free' || p.mode === 'chase');
    if (!ev && !fly && ball.state === 'free' && clock >= nextBig && free) startEvent();

    for (const p of players) {
      updatePlayer(p, dt);
      p.pose = poseOf(p);
    }
    updateEvent(dt);
    if (ball.state === 'free') stepBallVisible(dt);
    updateFly(dt);
    updateDebris(dt);
    applyShake(dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 5);
  }

  function render() {
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.drawImage(backdrop, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (ball.state === 'free') {
      const a = 0.28 / (1 + ball.h / S);
      fctx.fillStyle = `rgba(20,30,20,${a})`;
      fctx.beginPath();
      fctx.ellipse(ball.x, G + 3, R * 1.05, R * 0.3, 0, 0, TAU);
      fctx.fill();
    }
    for (const p of players) drawPlayer(fctx, p);
    if (ball.state === 'free') drawBall(fctx, ball.x, G - ball.h, R, ball);

    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, W, H);
    if (fly) {
      fly.trail.forEach((t, i) => {
        gctx.globalAlpha = 0.07 * (i + 1);
        drawBall(gctx, t[0], t[1], t[2], fly);
      });
      gctx.globalAlpha = 1;
      drawBall(gctx, fly.x, fly.y, fly.r, fly);
    }
    cracks = cracks.filter((k) => drawCrack(gctx, k));
    drawDebris(gctx);
    if (flash > 0) {
      gctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`;
      gctx.fillRect(0, 0, W, H);
    }
  }

  let last = 0;
  function frame(ts) {
    const dt = clamp((ts - last) / 1000 || 0.016, 0.001, 0.05);
    last = ts;
    clock += dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Запуск ----------
  function init() {
    W = document.documentElement.clientWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [field, glass]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    S = clamp(Math.min(W, H) * 0.17, 70, 150);
    R = S * 0.075;
    GRAV = 7 * S;
    HORIZON = H * 0.62;
    G = H * 0.9;
    MIN_X = W * 0.08;
    MAX_X = W * 0.92;
    drawBackdrop();

    clock = 0;
    ev = null;
    fly = null;
    shake = null;
    flash = 0;
    cracks = [];
    debris = [];
    nextBig = FIRST_KICK;
    page.style.transform = '';
    field.style.transform = '';
    players = [0, 1].map((i) => ({
      i, x: i ? W * 0.7 : W * 0.3, vx: 0, dir: i ? -1 : 1, phase: 0, mode: 'free',
      timer: 0, chaseT: 0, home: i ? W * 0.7 : W * 0.3, homeT: rand(1, 3), pose: null
    }));
    ball = newBall(W * 0.42, R, 0);
    players[0].mode = 'chase';
    players[0].chaseT = 0;
    for (const p of players) p.pose = walkPose(p);
  }

  let lastW = 0, lastH = 0;
  window.addEventListener('resize', () => {
    const w = document.documentElement.clientWidth;
    if (w === lastW && Math.abs(window.innerHeight - lastH) < 120) return;
    lastW = w;
    lastH = window.innerHeight;
    init();
  });

  lastW = document.documentElement.clientWidth;
  lastH = window.innerHeight;
  init();
  requestAnimationFrame(frame);
})();
