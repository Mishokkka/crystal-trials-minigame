import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, crystal, drawGlow, drawSoul} from "./base.js";

const LEVELS = {
  easy: {warning: [0.95, 0.95], fireDur: [0.36, 0.36], step: [1.30, 1.48], minSafeFrac: 0.42, moveSpeed: 218, spinChance: 0, width: [27, 33], spacing: [76, 98], rays: 5},
  medium: {warning: [0.80, 0.80], fireDur: [0.34, 0.38], step: [1.02, 1.24], minSafeFrac: 0.28, moveSpeed: 230, spinChance: 0, width: [30, 37], spacing: [68, 88], rays: 6},
  hard: {warning: [0.54, 0.66], fireDur: [0.32, 0.44], step: [0.76, 0.98], minSafeFrac: 0.16, moveSpeed: 252, spinChance: 0.32, width: [34, 42], spacing: [61, 80], rays: 7},
  insane: {warning: [0.43, 0.54], fireDur: [0.32, 0.46], step: [0.60, 0.80], minSafeFrac: 0.11, moveSpeed: 274, spinChance: 0.48, width: [37, 46], spacing: [56, 73], rays: 8}
};

const REACTION_SEC = 0.20;
const ARRIVAL_MARGIN = 0.025;
const CANDIDATE_ATTEMPTS = 28;
const CELL_SIZE = 10;
const CELL_RADIUS = CELL_SIZE / Math.SQRT2;
const COVERAGE_CELLS = (WIDTH / CELL_SIZE) * (HEIGHT / CELL_SIZE);

const EVAL_POINTS = [];
for (let x = 20; x <= WIDTH - 20; x += 22) {
  for (let y = 18; y <= HEIGHT - 18; y += 27) EVAL_POINTS.push({x, y});
}
const SPAWN = {x: WIDTH / 2, y: HEIGHT / 2};
const PROBES = [...EVAL_POINTS, SPAWN];
const ARENA_CORNERS = [{x: 0, y: 0}, {x: WIDTH, y: 0}, {x: WIDTH, y: HEIGHT}, {x: 0, y: HEIGHT}];

function keyboardDistance(from, to) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function beamHitsPoint(beam, time, px, py) {
  const angle = beam.angle + beam.spin * (time - beam.fire);
  const dist = Math.abs((px - beam.cx) * (-Math.sin(angle)) + (py - beam.cy) * Math.cos(angle));
  return dist < beam.width / 2 + SOUL_RADIUS;
}

function beamSweep(beam, start, end) {
  const first = beam.angle + beam.spin * (Math.max(start, beam.fire) - beam.fire);
  const last = beam.angle + beam.spin * (Math.min(end, beam.end) - beam.fire);
  return {
    cx: beam.cx, cy: beam.cy, radius: beam.width / 2 + SOUL_RADIUS,
    firstX: -Math.sin(first), firstY: Math.cos(first), lastX: -Math.sin(last), lastY: Math.cos(last)
  };
}

function sweepHitsPoint(sweep, x, y, margin = 0) {
  const dx = x - sweep.cx, dy = y - sweep.cy;
  const first = dx * sweep.firstX + dy * sweep.firstY;
  const last = dx * sweep.lastX + dy * sweep.lastY;
  const radius = sweep.radius + margin;
  return !((first >= radius && last >= radius) || (first <= -radius && last <= -radius));
}

function clipSafeSide(points, sweep, nx, ny) {
  const distance = point => (point.x - sweep.cx) * nx + (point.y - sweep.cy) * ny - sweep.radius;
  const clipped = [];
  let previous = points.at(-1);
  if (!previous) return clipped;
  let previousDist = distance(previous);
  for (const point of points) {
    const dist = distance(point);
    if ((previousDist >= 0) !== (dist >= 0)) {
      const fraction = previousDist / (previousDist - dist);
      clipped.push({x: previous.x + fraction * (point.x - previous.x), y: previous.y + fraction * (point.y - previous.y)});
    }
    if (dist >= 0) clipped.push(point);
    previous = point;
    previousDist = dist;
  }
  return clipped;
}

function drawSweepWarning(ctx, attack, progress) {
  const sweep = beamSweep(attack, attack.fire, attack.end);
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, HEIGHT);
  for (const side of [-1, 1]) {
    const firstSafe = clipSafeSide(ARENA_CORNERS, sweep, side * sweep.firstX, side * sweep.firstY);
    const safe = clipSafeSide(firstSafe, sweep, side * sweep.lastX, side * sweep.lastY);
    if (safe.length < 3) continue;
    ctx.moveTo(safe[0].x, safe[0].y);
    for (const point of safe.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }
  ctx.fillStyle = PALETTE.crimson;
  ctx.globalAlpha = 0.16 + progress * 0.12;
  ctx.fill("evenodd");
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
    let prevSafe = [SPAWN];
    let prevEnd = 0;
    let fire = 0.72;
    let volleyIndex = 0;
    while (fire < this.duration - 0.35) {
      const warn = this.between(...this.cfg.warning);
      const cue = Math.max(0.05, fire - warn);
      const fireDur = this.between(...this.cfg.fireDur);
      const end = fire + fireDur;
      const preferScanner = this.cfg.spinChance > 0 && this.random() < this.cfg.spinChance;
      const departure = Math.max(prevEnd, cue + REACTION_SEC);
      const maxReach = this.cfg.moveSpeed * Math.max(0, fire - ARRIVAL_MARGIN - departure);
      const reachableProbes = PROBES.filter(probe => prevSafe.some(previous =>
        keyboardDistance(previous, probe) <= maxReach
      ));

      const maxCheckEnd = Math.max(end, fire + 0.55);
      const activeEarlier = this.attacks.filter(a => a.end > fire && a.fire < maxCheckEnd);
      let best = null;

      const evaluate = (beams, minScore = -Infinity) => {
        const checkEnd = Math.max(end, ...beams.map(b => b.end));
        const sweeps = [...activeEarlier, ...beams].map(beam => beamSweep(beam, fire, checkEnd));
        const safeProbes = reachableProbes.filter(probe =>
          !sweeps.some(sweep => sweepHitsPoint(sweep, probe.x, probe.y, 3)));
        if (!safeProbes.length) return null;
        const safeFrac = this.measureSafeFraction(sweeps);
        if (safeFrac < this.cfg.minSafeFrac) return null;
        const coveredPrev = prevSafe.filter(probe =>
          sweeps.some(sweep => sweepHitsPoint(sweep, probe.x, probe.y))).length;
        const scannerBonus = preferScanner && beams.some(beam => beam.spin !== 0) ? 0.65 : 0;
        const score = 2 * coveredPrev / prevSafe.length + (1 - safeFrac) + 0.015 * beams.length + scannerBonus;
        if (score <= minScore || !this.hasSafeArea(sweeps)) return null;
        return {beams, checkEnd, safeProbes, score};
      };

      if (volleyIndex % 3 === 1) {
        const grid = volleyIndex % 6 === 4;
        for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt++) {
          const candidate = evaluate(this.generateOrthogonal(cue, fire, end, prevSafe, grid), best?.score);
          if (candidate) best = candidate;
        }
      }

      if (!best) {
        for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt++) {
          const candidate = evaluate(this.generateCandidate(cue, fire, end, prevSafe, preferScanner), best?.score);
          if (candidate) best = candidate;
        }
      }

      best ??= this.buildFallback(cue, fire, end, prevSafe[0], evaluate);
      this.attacks.push(...best.beams);
      this.cues.push({time: cue, sound: "Telegraph"}, {time: fire, sound: "BeamFire"});
      prevSafe = best.safeProbes;
      prevEnd = best.checkEnd;
      fire += this.between(...this.cfg.step);
      volleyIndex++;
    }
  }

  measureSafeFraction(sweeps) {
    let safe = 0;
    for (const pt of EVAL_POINTS) {
      const hit = sweeps.some(sweep => sweepHitsPoint(sweep, pt.x, pt.y));
      if (!hit) safe++;
    }
    return safe / EVAL_POINTS.length;
  }

  hasSafeArea(sweeps) {
    let required = Math.ceil(this.cfg.minSafeFrac * COVERAGE_CELLS);
    let allowedHits = COVERAGE_CELLS - required;
    for (let x = CELL_SIZE / 2; x < WIDTH; x += CELL_SIZE) {
      for (let y = CELL_SIZE / 2; y < HEIGHT; y += CELL_SIZE) {
        if (sweeps.some(sweep => sweepHitsPoint(sweep, x, y, CELL_RADIUS))) {
          if (--allowedHits < 0) return false;
        } else if (--required === 0) return true;
      }
    }
    return false;
  }

  buildFallback(cue, fire, end, pocket, evaluate) {
    const width = this.cfg.width[0];
    const spacing = this.cfg.spacing[0];
    let best = evaluate([]);
    for (let cy = spacing / 2; cy < HEIGHT; cy += spacing) {
      if (Math.abs(cy - pocket.y) <= width / 2 + SOUL_RADIUS + 3) continue;
      const rail = {cue, fire, end, cx: SPAWN.x, cy, angle: 0, spin: 0, width};
      best = evaluate([...best.beams, rail]) ?? best;
    }
    return best;
  }

  generateOrthogonal(cue, fire, end, prevSafe, grid) {
    const anchor = prevSafe[Math.floor(this.random() * prevSafe.length)];
    const width = this.between(...this.cfg.width) * (grid ? 0.78 : 1);
    const spacing = Math.max(this.between(...this.cfg.spacing) * (grid ? 1.65 : 1), width + 2 * SOUL_RADIUS + 22);
    const beams = [];
    const horizontal = this.random() < 0.5;
    const addBank = isHorizontal => {
      const inset = 18;
      const extent = isHorizontal ? HEIGHT : WIDTH;
      const center = isHorizontal ? anchor.y : anchor.x;
      const offset = center - inset + this.between(-spacing / 4, spacing / 4);
      const first = inset + ((offset % spacing) + spacing) % spacing;
      for (let pos = first; pos <= extent - inset; pos += spacing) {
        const cx = isHorizontal ? anchor.x : pos;
        const cy = isHorizontal ? pos : anchor.y;
        beams.push({cue, fire, end, cx, cy, angle: isHorizontal ? 0 : Math.PI / 2, spin: 0, width});
      }
    };
    addBank(horizontal);
    if (grid) addBank(!horizontal);
    return beams;
  }

  generateCandidate(cue, fire, end, prevSafe, preferScanner) {
    const anchor = prevSafe[Math.floor(this.random() * prevSafe.length)];
    const width = this.between(...this.cfg.width);
    const kindRoll = this.random();

    // Gaster-Blaster perimeter fan
    if (kindRoll < 0.36) {
      const side = Math.floor(this.random() * 4);
      const ex = side === 0 ? 18 : side === 1 ? WIDTH - 18 : this.between(90, WIDTH - 90);
      const ey = side === 2 ? 18 : side === 3 ? HEIGHT - 18 : this.between(70, HEIGHT - 70);
      const aimAngle = Math.atan2(anchor.y - ey, anchor.x - ex);
      const rayCount = this.cfg.rays;
      const step = this.between(0.23, 0.37);
      const center = Math.floor(rayCount / 2) - (rayCount % 2 === 0 && this.random() < 0.5 ? 1 : 0);
      return Array.from({length: rayCount}, (_, index) => ({
        cue, fire, end, cx: ex, cy: ey, angle: aimAngle + (index - center) * step, spin: 0, width: width * 0.85
      }));
    }

    const angle = this.between(0, Math.PI);
    const scanning = preferScanner && this.random() < 0.65;
    const spacing = this.between(...this.cfg.spacing) * (scanning ? 1.24 : 1);
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    const centerBeam = {cue, fire, end, cx: anchor.x, cy: anchor.y, angle, spin: 0, width};
    const beams = [scanning ? {...centerBeam, end: fire + this.between(0.42, 0.52),
      spin: this.direction * this.between(0.32, 0.53), width: width * 0.80} : centerBeam];
    for (const side of [-1, 1]) {
      for (let offset = spacing; offset < WIDTH + HEIGHT; offset += spacing) {
        const cx = anchor.x + nx * offset * side, cy = anchor.y + ny * offset * side;
        if (!borderIntersections(cx, cy, angle)) break;
        beams.push({...centerBeam, cx, cy});
      }
    }
    if (kindRoll > 0.73) {
      beams.push({...centerBeam, angle: angle + this.between(0.68, 1.35), width: width * 0.9});
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
        if (attack.spin !== 0) drawSweepWarning(ctx, attack, progress);
        ctx.fillStyle = `rgba(245, 158, 11, ${0.08 + progress * 0.12})`;
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
