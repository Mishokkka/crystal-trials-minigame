import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal} from "./base.js";

const LEVELS = {
  easy: {width: 54, turns: 3, radius: 29, gates: 0, grabRadius: 24, gatePeriod: [0, 0], gateClosed: [0, 0]},
  medium: {width: 42, turns: 4, radius: 24, gates: 0, grabRadius: 24, gatePeriod: [0, 0], gateClosed: [0, 0]},
  hard: {width: 27, turns: 6, radius: 15, gates: 3, grabRadius: 22, gatePeriod: [1.28, 1.62], gateClosed: [0.28, 0.36]},
  insane: {width: 23, turns: 8, radius: 13, gates: 4, grabRadius: 20, gatePeriod: [1.05, 1.38], gateClosed: [0.30, 0.39]}
};
const GOAL_RADIUS = 11;
const CURSOR_RADIUS = 6;
const TRAIL_LENGTH = 20;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointAlong(a, b, fraction) {
  return {x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction};
}

function roundCorners(points, radius) {
  const path = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const before = points[i - 1];
    const after = points[i + 1];
    const dBefore = distance(corner, before);
    const dAfter = distance(corner, after);
    if (dBefore < 1e-3 || dAfter < 1e-3) continue;
    const retreat = Math.min(radius, dBefore * 0.44, dAfter * 0.44);
    const a = pointAlong(corner, before, retreat / dBefore);
    const b = pointAlong(corner, after, retreat / dAfter);
    path.push(a);
    for (let j = 1; j <= 12; j++) {
      const fraction = j / 12;
      path.push(pointAlong(pointAlong(a, corner, fraction), pointAlong(corner, b, fraction), fraction));
    }
  }
  path.push(points.at(-1));
  return path;
}

function corridorMask(path, radius) {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-6) continue;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
    const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
    const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(a.y, b.y) + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const fraction = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1);
        if ((x - a.x - dx * fraction) ** 2 + (y - a.y - dy * fraction) ** 2 <= radius ** 2) {
          mask[y * WIDTH + x] = 1;
        }
      }
    }
  }
  return mask;
}

export class MazeGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    const cfg = this.cfg = LEVELS[session.difficulty];
    this.width = cfg.width;
    this.grabRadius = cfg.grabRadius;
    const gated = cfg.gates > 0;
    const points = gated ? this.buildSwitchbacks(cfg.turns) : this.buildSerpentine(cfg.turns);
    this.origin = points[0];
    this.goal = points.at(-1);
    this.path = roundCorners(points, cfg.radius);
    this.mask = corridorMask(this.path, cfg.width / 2 - CURSOR_RADIUS - 0.6);
    this.gates = gated ? this.buildGates(cfg.gates, cfg.gatePeriod, cfg.gateClosed) : [];
    this.buildGateCues();
    this.trail = [this.origin];
    Object.assign(this.state, this.origin, {activeStarted: false, tracking: false});
  }

  buildSerpentine(turns) {
    let upper = this.random() < 0.5;
    const band = () => upper ? this.between(69, 111) : this.between(245, 290);
    let y = band();
    const points = [{x: 41, y}];
    for (let i = 1; i <= turns; i++) {
      const x = 41 + i * (398 / (turns + 1)) + this.between(-6, 6);
      points.push({x, y});
      upper = !upper;
      y = band();
      points.push({x, y});
    }
    points.push({x: 439, y});
    return points;
  }

  buildSwitchbacks(turns) {
    const bands = [56, 130, 224, 298];
    let band = Math.floor(this.random() * bands.length);
    let y = bands[band] + this.between(-8, 8);
    const points = [{x: 36, y}];
    for (let i = 1; i <= turns; i++) {
      const x = 36 + i * (408 / (turns + 1)) + this.between(-6, 6);
      points.push({x, y: y + this.between(-9, 9)});
      // Bounded 1..2 band transitions prevent extreme 2x path-length outliers
      const preferred = band <= 1
        ? [band + 1, band + 2, band - 1].filter(idx => idx >= 0 && idx < bands.length)
        : [band - 1, band - 2, band + 1].filter(idx => idx >= 0 && idx < bands.length);
      band = preferred[Math.floor(this.random() * preferred.length)];
      y = bands[band] + this.between(-8, 8);
      points.push({x, y});
    }
    points.push({x: 444, y});
    return this.random() < 0.5 ? points : points.map(point => ({x: WIDTH - point.x, y: point.y}));
  }

  buildGates(gateCount, gatePeriod, gateClosed) {
    const candidates = [];
    for (let i = 1; i < this.path.length; i++) {
      const start = this.path[i - 1];
      const end = this.path[i];
      const length = distance(start, end);
      if (length < 21) continue;
      const mid = pointAlong(start, end, 0.5);
      if (distance(mid, this.origin) < 54 || distance(mid, this.goal) < 54) continue;
      candidates.push({start, end, length});
    }
    if (!candidates.length) return [];

    const gates = [];
    const target = Math.min(gateCount, candidates.length);
    for (let index = 0; index < target; index++) {
      const low = Math.floor(index * candidates.length / target);
      const high = Math.max(low + 1, Math.floor((index + 1) * candidates.length / target));
      const pool = candidates.slice(low, high);
      let chosen = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const seg = pool[Math.floor(this.random() * pool.length)];
        const pos = pointAlong(seg.start, seg.end, this.between(0.40, 0.60));
        if (distance(pos, this.origin) < 54 || distance(pos, this.goal) < 54) continue;
        if (gates.some(g => distance(pos, g) < 46)) continue;
        chosen = {seg, pos};
        break;
      }
      if (!chosen) continue;
      const {seg, pos} = chosen;
      const period = this.between(...gatePeriod);
      gates.push({
        ...pos,
        tx: (seg.end.x - seg.start.x) / seg.length,
        ty: (seg.end.y - seg.start.y) / seg.length,
        period,
        phase: this.between(0, period),
        closed: this.between(...gateClosed)
      });
    }
    return gates;
  }

  buildGateCues() {
    if (!this.gates.length) return;
    const raw = [];
    for (const gate of this.gates) {
      const warnOffset = gate.period - 0.20;
      for (let k = 0; ; k++) {
        const time = k * gate.period + warnOffset - gate.phase;
        if (time >= this.duration - 0.15) break;
        if (time >= 0.12) raw.push(time);
      }
    }
    raw.sort((a, b) => a - b);
    let lastCue = -1;
    for (const time of raw) {
      if (time - lastCue >= 0.45) {
        this.cues.push({time, sound: "GateWarn"});
        lastCue = time;
      }
    }
  }

  allows({x, y}) {
    const column = Math.round(x);
    const row = Math.round(y);
    return column >= 0 && column < WIDTH && row >= 0 && row < HEIGHT && this.mask[row * WIDTH + column] === 1;
  }

  gatePhase(gate, time) {
    return (time + gate.phase) % gate.period;
  }

  gateBlocks(point, time) {
    return this.gates.some(gate => {
      if (this.gatePhase(gate, time) >= gate.closed) return false;
      const dx = point.x - gate.x;
      const dy = point.y - gate.y;
      return Math.abs(dx * gate.tx + dy * gate.ty) < 9 && Math.abs(dy * gate.tx - dx * gate.ty) <= this.width / 2;
    });
  }

  hitWall(time) {
    this.leavePointer();
    this.damage(time, 0.6);
  }

  leavePointer() {
    Object.assign(this.state, {tracking: false, moving: false, vx: 0, vy: 0});
  }

  start(pointer) {
    if (pointer) this.movePointer(pointer, 0);
  }

  step(dt, time, input, pointer = null) {
    if (this.result) return;
    this.currentTime = time;
    if (time >= this.duration) {
      this.finish(false, "timeout", time);
      return;
    }
    if (this.state.activeStarted && time >= this.state.invulnerableUntil && this.gateBlocks(this.state, time)) {
      this.hitWall(time);
      return;
    }
    if (!this.state.tracking && pointer && time >= this.state.invulnerableUntil) {
      this.movePointer(pointer, time);
    }
  }

  movePointer(point, time) {
    if (this.result || time < this.state.invulnerableUntil) return;
    const state = this.state;
    const from = {x: state.x, y: state.y};
    let target = point;
    let length = distance(from, target);
    const holding = state.tracking;
    if (!holding) {
      if (length > this.grabRadius) return;
      if (!this.allows(target)) {
        if (length <= 15 && !this.gateBlocks(from, time)) {
          target = from;
          length = 0;
        } else {
          return;
        }
      }
    }

    // Sample the entire cursor segment so fast sweeps cannot tunnel across walls.
    const samples = Math.max(1, Math.ceil(length));
    let lastSafe = from;
    let reachedGoal = false;
    let collision = false;
    const newTrail = [];
    for (let i = 1; i <= samples; i++) {
      const next = pointAlong(from, target, i / samples);
      if (!this.allows(next) || this.gateBlocks(next, time)) {
        collision = true;
        break;
      }
      lastSafe = next;
      if (i % 7 === 0) newTrail.push(next);
      if ((reachedGoal = distance(next, this.goal) <= GOAL_RADIUS)) break;
    }
    if (!holding && collision && !reachedGoal) return;

    const firstGrab = !state.activeStarted;
    state.activeStarted = true;
    state.tracking = true;
    state.moving = length > 0.5;
    state.x = lastSafe.x;
    state.y = lastSafe.y;
    state.progress = reachedGoal ? 1 : 0;
    if (distance(this.trail.at(-1), lastSafe) > 2) {
      this.trail = this.trail.concat(newTrail, lastSafe).slice(-TRAIL_LENGTH);
    }
    if (firstGrab) this.onEvent("timingHit");
    if (reachedGoal) this.finish(true, "maze", time);
    else if (collision) this.hitWall(time);
  }

  drawGates(ctx, time) {
    const half = this.width / 2;
    for (const gate of this.gates) {
      const phase = this.gatePhase(gate, time);
      const closed = phase < gate.closed;
      const warning = phase > gate.period - 0.20;
      const x = gate.ty * half;
      const y = gate.tx * half;
      ctx.beginPath();
      ctx.moveTo(gate.x - x, gate.y + y);
      ctx.lineTo(gate.x + x, gate.y - y);
      ctx.strokeStyle = closed ? (this.insane ? PALETTE.insane : "#f688ec") : warning ? PALETTE.gold : "#8be1b993";
      ctx.lineWidth = closed ? 6 : warning ? 3 : 1.5;
      ctx.setLineDash(closed || warning ? [] : [3, 3]);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = closed || warning ? 9 : 0;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  draw(ctx, time, state, labels, trailOverride) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.path[0].x, this.path[0].y);
    for (const point of this.path.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.lineWidth = this.width + 3;
    ctx.strokeStyle = this.insane ? "#c84b7a" : "#9f6dda";
    ctx.shadowColor = this.insane ? "#9f1239" : "#7839bc";
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = this.width;
    ctx.strokeStyle = "#241537";
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = "#d5a4ff36";
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawGates(ctx, time);
    for (const [point, color, label] of [[this.origin, PALETTE.mint, labels.start], [this.goal, PALETTE.gold, labels.finish]]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, GOAL_RADIUS + 1, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "600 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(label, point.x, point.y - this.width / 2 - 10);
    }

    const trail = trailOverride ?? this.trail;
    for (let i = 1; i < trail.length; i++) {
      const alpha = i / trail.length;
      ctx.globalAlpha = alpha * 0.69;
      ctx.strokeStyle = PALETTE.pink;
      ctx.shadowColor = PALETTE.pink;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 1 + alpha * 4;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 12;
    ctx.shadowColor = PALETTE.pink;
    ctx.globalAlpha = time < state.invulnerableUntil && Math.floor(time * 18) % 2 ? 0.25 : 1;
    if (!state.tracking) {
      ctx.beginPath();
      ctx.arc(state.x, state.y, 15 + Math.sin(time * 7) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = !state.activeStarted ? PALETTE.mint : PALETTE.lilac;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    crystal(ctx, state.x, state.y, 7, 8, "#f0ceff");
    ctx.restore();
  }
}
