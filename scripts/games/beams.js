import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, crystal, drawGlow, drawSoul} from "./base.js";

const LEVELS = {
  easy: {warning: [0.95, 0.95], fireDur: [0.36, 0.36], step: [1.30, 1.48], minSafeFrac: 0.42, moveSpeed: 218, spinChance: 0},
  medium: {warning: [0.80, 0.80], fireDur: [0.34, 0.38], step: [1.02, 1.24], minSafeFrac: 0.28, moveSpeed: 230, spinChance: 0},
  hard: {warning: [0.54, 0.66], fireDur: [0.32, 0.44], step: [0.76, 0.98], minSafeFrac: 0.16, moveSpeed: 252, spinChance: 0.32},
  insane: {warning: [0.43, 0.54], fireDur: [0.32, 0.46], step: [0.60, 0.80], minSafeFrac: 0.11, moveSpeed: 274, spinChance: 0.48}
};

// 5x4 probe grid including spawn center (240, 180) so AFK spots are tracked deterministically
const PROBES = [];
for (const x of [50, 145, 240, 335, 430]) {
  for (const y of [55, 138, 222, 305]) PROBES.push({x, y});
}

const EVAL_POINTS = [];
for (let x = 25; x <= WIDTH - 25; x += 43) {
  for (let y = 25; y <= HEIGHT - 25; y += 39) EVAL_POINTS.push({x, y});
}

function beamHitsPoint(beam, time, px, py) {
  const angle = beam.angle + beam.spin * (time - beam.fire);
  const dist = Math.abs((px - beam.cx) * (-Math.sin(angle)) + (py - beam.cy) * Math.cos(angle));
  return dist < beam.width / 2 + SOUL_RADIUS;
}

function borderIntersections(cx, cy, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const minX = 11, maxX = WIDTH - 11, minY = 11, maxY = HEIGHT - 11;
  const ts = [];
  if (Math.abs(dx) > 1e-5) {
    for (const bx of [minX, maxX]) {
      const t = (bx - cx) / dx;
      const y = cy + t * dy;
      if (y >= minY - 1 && y <= maxY + 1) ts.push({t, x: bx, y: clamp(y, minY, maxY)});
    }
  }
  if (Math.abs(dy) > 1e-5) {
    for (const by of [minY, maxY]) {
      const t = (by - cy) / dy;
      const x = cx + t * dx;
      if (x >= minX - 1 && x <= maxX + 1) ts.push({t, x: clamp(x, minX, maxX), y: by});
    }
  }
  if (ts.length < 2) return null;
  ts.sort((a, b) => a.t - b.t);
  return [ts[0], ts.at(-1)];
}

export class BeamsGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.attacks = [];
    this.buildVolleys();
    this.cues.sort((a, b) => a.time - b.time);
  }

  buildVolleys() {
    let prevSafe = PROBES.filter(p => Math.hypot(p.x - WIDTH / 2, p.y - HEIGHT / 2) < 95);
    let fire = 0.72;
    while (fire < this.duration - 0.35) {
      const warn = this.between(...this.cfg.warning);
      const cue = Math.max(0.05, fire - warn);
      const fireDur = this.between(...this.cfg.fireDur);
      const end = fire + fireDur;
      const maxReach = this.cfg.moveSpeed * (fire - cue) * 0.75;

      const maxCheckEnd = Math.max(end, fire + 0.55);
      const activeEarlier = this.attacks.filter(a => a.end > fire && a.fire < maxCheckEnd);
      let bestVolley = null;
      let bestScore = -1;
      let bestSafeProbes = null;

      for (let attempt = 0; attempt < 12; attempt++) {
        const beams = this.generateCandidate(cue, fire, end, prevSafe);
        const checkEnd = Math.max(end, ...beams.map(b => b.end));
        const combined = [...activeEarlier, ...beams];
        const safeFrac = this.measureSafeFraction(combined, fire, checkEnd);
        if (safeFrac < this.cfg.minSafeFrac) continue;

        const safeProbes = PROBES.filter(p =>
          !this.pointHitInInterval(combined, p.x, p.y, fire, checkEnd)
        );
        const reachable = safeProbes.some(sp =>
          prevSafe.some(ps => Math.hypot(sp.x - ps.x, sp.y - ps.y) <= maxReach)
        );
        if (!reachable) continue;

        const coveredPrev = prevSafe.filter(ps => this.pointHitInInterval(beams, ps.x, ps.y, fire, checkEnd)).length;
        const score = coveredPrev * 10 + safeFrac;
        if (score > bestScore) {
          bestScore = score;
          bestVolley = beams;
          bestSafeProbes = safeProbes;
        }
      }

      if (!bestVolley) {
        const target = prevSafe[Math.floor(this.random() * prevSafe.length)] ?? {x: WIDTH / 2, y: HEIGHT / 2};
        const angle = this.between(0, Math.PI);
        bestVolley = [{cue, fire, end, cx: target.x, cy: target.y, angle, spin: 0, width: 40}];
        bestSafeProbes = PROBES.filter(p => !this.pointHitInInterval(bestVolley, p.x, p.y, fire, end));
      }

      this.attacks.push(...bestVolley);
      this.cues.push({time: cue, sound: "Telegraph"}, {time: fire, sound: "BeamFire"});
      if (bestSafeProbes?.length) prevSafe = bestSafeProbes;
      fire += this.between(...this.cfg.step);
    }
  }

  measureSafeFraction(beams, fire, end) {
    const times = [fire, (fire + end) / 2, end - 0.02];
    let safe = 0;
    for (const pt of EVAL_POINTS) {
      const hit = times.some(t => beams.some(b => t >= b.fire && t < b.end && beamHitsPoint(b, t, pt.x, pt.y)));
      if (!hit) safe++;
    }
    return safe / EVAL_POINTS.length;
  }

  pointHitInInterval(beams, x, y, fire, end) {
    for (const t of [fire, (fire + end) / 2, end - 0.02]) {
      if (beams.some(b => t >= b.fire && t < b.end && beamHitsPoint(b, t, x, y))) return true;
    }
    return false;
  }

  generateCandidate(cue, fire, end, prevSafe) {
    const anchor = prevSafe[Math.floor(this.random() * prevSafe.length)] ?? {x: WIDTH / 2, y: HEIGHT / 2};
    const isHard = this.hard || this.insane;
    const width = isHard ? this.between(40, 56) : this.between(32, 42);
    const kindRoll = this.random();

    // Sweeping scanner on Hard / Insane
    if (this.random() < this.cfg.spinChance) {
      const sweepEnd = fire + this.between(0.42, 0.52);
      const spin = this.direction * this.between(0.40, 0.68);
      const baseAngle = this.between(0, Math.PI);
      const beams = [{cue, fire, end: sweepEnd, cx: anchor.x, cy: anchor.y, angle: baseAngle, spin, width: width * 0.85}];
      if (this.insane || this.random() < 0.55) {
        const off = this.between(65, 115) * this.direction;
        const a2 = baseAngle + Math.PI / 2;
        beams.push({
          cue, fire, end: sweepEnd,
          cx: clamp(anchor.x + Math.cos(a2) * off, 60, WIDTH - 60),
          cy: clamp(anchor.y + Math.sin(a2) * off, 55, HEIGHT - 55),
          angle: a2, spin: 0, width: width * 0.85
        });
      }
      return beams;
    }

    // Family 1: X-cross through an active safe anchor
    if (kindRoll < 0.34) {
      const a1 = this.between(0.18, Math.PI - 0.18);
      const a2 = a1 + this.between(0.68, 1.35);
      const beams = [
        {cue, fire, end, cx: anchor.x, cy: anchor.y, angle: a1, spin: 0, width},
        {cue, fire, end, cx: anchor.x, cy: anchor.y, angle: a2, spin: 0, width}
      ];
      if (isHard && this.random() < 0.65) {
        const shift = this.direction * this.between(95, 130);
        beams.push({
          cue, fire, end,
          cx: clamp(anchor.x - Math.sin(a1) * shift, 40, WIDTH - 40),
          cy: clamp(anchor.y + Math.cos(a1) * shift, 40, HEIGHT - 40),
          angle: a1, spin: 0, width: width * 0.9
        });
      }
      return beams;
    }

    // Family 2: Gaster-Blaster perimeter fan (3-5 rays from one edge point)
    if (kindRoll < 0.68) {
      const side = Math.floor(this.random() * 4);
      const ex = side === 0 ? 18 : side === 1 ? WIDTH - 18 : this.between(90, WIDTH - 90);
      const ey = side === 2 ? 18 : side === 3 ? HEIGHT - 18 : this.between(70, HEIGHT - 70);
      const aimAngle = Math.atan2(anchor.y - ey, anchor.x - ex);
      const rayCount = this.insane ? 5 : this.hard ? 4 : 3;
      const step = this.between(0.28, 0.40);
      const startOffset = -((rayCount - 1) / 2) * step;
      return Array.from({length: rayCount}, (_, i) => ({
        cue, fire, end, cx: ex, cy: ey, angle: aimAngle + startOffset + i * step, spin: 0, width: width * 0.78
      }));
    }

    // Family 3: Angled parallel grid / diagonal volley
    const angleChoices = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, 2 * Math.PI / 3, 3 * Math.PI / 4, 5 * Math.PI / 6];
    const base = angleChoices[Math.floor(this.random() * angleChoices.length)] + this.between(-0.12, 0.12);
    const nx = -Math.sin(base), ny = Math.cos(base);
    const count = this.insane ? 4 : isHard ? 3 : 2;
    const spacing = this.between(88, 122);
    const beams = [];
    for (let i = 0; i < count; i++) {
      const offset = (i - Math.floor(count / 2)) * spacing;
      beams.push({cue, fire, end, cx: anchor.x + nx * offset, cy: anchor.y + ny * offset, angle: base, spin: 0, width});
    }
    if (isHard && this.random() < 0.6) {
      const crossAngle = base + Math.PI / 2 + this.between(-0.2, 0.2);
      beams.push({cue, fire, end, cx: anchor.x, cy: anchor.y, angle: crossAngle, spin: 0, width: width * 0.9});
    }
    return beams;
  }

  update(dt, time, input) {
    this.moveFree(dt, input, this.cfg.moveSpeed, time);
    for (const attack of this.attacks) {
      if (time < attack.fire || time >= attack.end) continue;
      if (beamHitsPoint(attack, time, this.state.x, this.state.y)) this.damage(time);
    }
  }

  draw(ctx, time, state) {
    const fireGlow = this.insane ? PALETTE.insane : PALETTE.pink;
    const fireFill = this.insane ? "#ff5c7cbb" : "#c084fcbb";

    for (const attack of this.attacks) {
      if (time < attack.cue || time >= attack.end) continue;
      const aiming = time < attack.fire;
      const angle = aiming ? attack.angle : attack.angle + attack.spin * (time - attack.fire);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const nx = -dy, ny = dx;
      const centerDist = Math.abs((WIDTH / 2 - attack.cx) * nx + (HEIGHT / 2 - attack.cy) * ny);
      if (centerDist > 300 + attack.width / 2 + 16) continue;
      const proj = (WIDTH / 2 - attack.cx) * dx + (HEIGHT / 2 - attack.cy) * dy;
      const midX = attack.cx + dx * proj;
      const midY = attack.cy + dy * proj;
      const p1 = {x: midX - dx * 360, y: midY - dy * 360};
      const p2 = {x: midX + dx * 360, y: midY + dy * 360};
      const emitters = borderIntersections(attack.cx, attack.cy, angle);

      ctx.save();
      if (aiming) {
        const progress = clamp((time - attack.cue) / (attack.fire - attack.cue), 0, 1);
        ctx.fillStyle = `rgba(245, 158, 11, ${0.12 + progress * 0.16})`;
        ctx.beginPath();
        ctx.moveTo(p1.x + nx * attack.width / 2, p1.y + ny * attack.width / 2);
        ctx.lineTo(p2.x + nx * attack.width / 2, p2.y + ny * attack.width / 2);
        ctx.lineTo(p2.x - nx * attack.width / 2, p2.y - ny * attack.width / 2);
        ctx.lineTo(p1.x - nx * attack.width / 2, p1.y - ny * attack.width / 2);
        ctx.closePath();
        ctx.fill();

        const railOff = (attack.width / 2) * (1 - progress * 0.72);
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 22) ** 2;
        ctx.beginPath();
        ctx.moveTo(p1.x + nx * railOff, p1.y + ny * railOff);
        ctx.lineTo(p2.x + nx * railOff, p2.y + ny * railOff);
        ctx.moveTo(p1.x - nx * railOff, p1.y - ny * railOff);
        ctx.lineTo(p2.x - nx * railOff, p2.y - ny * railOff);
        ctx.stroke();

        ctx.strokeStyle = "#fde68a";
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (attack.spin !== 0) {
          const dir = Math.sign(attack.spin);
          ctx.strokeStyle = "#fb7185";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(attack.cx, attack.cy, 22, angle - dir * 0.15, angle + dir * 0.65, dir < 0);
          ctx.stroke();
        }
      } else {
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);

        ctx.strokeStyle = fireGlow;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = attack.width + 16;
        ctx.stroke();

        ctx.strokeStyle = fireFill;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = attack.width;
        ctx.stroke();

        ctx.strokeStyle = "#fff4ff";
        ctx.globalAlpha = 1;
        ctx.lineWidth = 5;
        ctx.stroke();
      }

      if (emitters) {
        const [e1, e2] = emitters;
        const emitterColor = aiming ? (attack.spin !== 0 ? PALETTE.crimson : PALETTE.gold) : fireGlow;
        ctx.globalAlpha = 1;
        drawGlow(ctx, e1.x, e1.y, 16, emitterColor, 0.35);
        drawGlow(ctx, e2.x, e2.y, 16, emitterColor, 0.35);
        crystal(ctx, e1.x, e1.y, 8, 11, emitterColor, angle + Math.PI / 2);
        crystal(ctx, e2.x, e2.y, 8, 11, emitterColor, angle + Math.PI / 2);
      }
      ctx.restore();
    }
    drawSoul(ctx, state, time);
  }
}
