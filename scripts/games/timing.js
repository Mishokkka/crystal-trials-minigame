import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal, drawGlow} from "./base.js";

export const TIMING_RULES = {
  easy: {
    passes: 4, count: 4, required: 3, zoneWidth: 80, coreWidth: 24,
    passDur: 1.55, pause: 0.22, doublePasses: 0, shapes: ["line", "arc"], moveChance: 0, moveAmp: [0, 0]
  },
  medium: {
    passes: 5, count: 5, required: 4, zoneWidth: 62, coreWidth: 19,
    passDur: 1.34, pause: 0.20, doublePasses: 0, shapes: ["line", "arc", "wave", "circle"], moveChance: 0.42, moveAmp: [0.055, 0.085]
  },
  hard: {
    passes: 5, count: 7, required: 5, zoneWidth: 48, coreWidth: 15,
    passDur: 1.32, pause: 0.18, doublePasses: 2, shapes: ["arc", "wave", "circle"], moveChance: 0.68, moveAmp: [0.075, 0.12]
  },
  insane: {
    passes: 6, count: 9, required: 7, zoneWidth: 40, coreWidth: 13,
    passDur: 1.18, pause: 0.15, doublePasses: 3, shapes: ["wave", "circle", "arc"], moveChance: 0.85, moveAmp: [0.095, 0.145]
  }
};

const TRACK_SAMPLES = 64;

function buildTrack(shape, flip = 1, variant = 0, angle0 = -Math.PI / 2) {
  const raw = [];
  const rawSteps = 240;
  for (let i = 0; i <= rawSteps; i++) {
    const s = i / rawSteps;
    let x, y;
    if (shape === "arc") {
      const cx = 240;
      const cy = 176 + flip * 102;
      const r = 192;
      const sweep = 1.92;
      const midAngle = flip === 1 ? -Math.PI / 2 : Math.PI / 2;
      const theta = midAngle + flip * (s - 0.5) * sweep;
      x = cx + Math.cos(theta) * r;
      y = cy + Math.sin(theta) * r;
    } else if (shape === "wave") {
      const cycles = variant ? 1.5 : 1.0;
      const amp = variant ? 44 : 52;
      x = 52 + 376 * s;
      y = 172 + flip * amp * Math.sin(Math.PI * 2 * cycles * s);
    } else if (shape === "circle") {
      const theta = angle0 + s * Math.PI * 2;
      x = 240 + Math.cos(theta) * 84;
      y = 170 + Math.sin(theta) * 84;
    } else {
      x = 52 + 376 * s;
      y = 176;
    }
    raw.push({x, y});
  }

  const cum = [0];
  let totalLen = 0;
  for (let i = 1; i < raw.length; i++) {
    totalLen += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    cum.push(totalLen);
  }

  const pts = [];
  let cursor = 0;
  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const target = (i / TRACK_SAMPLES) * totalLen;
    while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor++;
    const segLen = cum[cursor + 1] - cum[cursor];
    const frac = segLen > 1e-6 ? (target - cum[cursor]) / segLen : 0;
    const x = raw[cursor].x + (raw[cursor + 1].x - raw[cursor].x) * frac;
    const y = raw[cursor].y + (raw[cursor + 1].y - raw[cursor].y) * frac;
    pts.push({x, y, nx: 0, ny: -1});
  }

  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    pts[i].nx = -dy / len;
    pts[i].ny = dx / len;
  }

  const ticks = [];
  for (let i = 4; i < TRACK_SAMPLES; i += 4) {
    const p = pts[i];
    ticks.push({
      ax: p.x + p.nx * 14, ay: p.y + p.ny * 14,
      bx: p.x + p.nx * 8, by: p.y + p.ny * 8,
      cx: p.x - p.nx * 14, cy: p.y - p.ny * 14,
      dx: p.x - p.nx * 8, dy: p.y - p.ny * 8
    });
  }

  return {shape, length: totalLen, pts, ticks};
}

function evalTrack(track, u) {
  const clamped = clamp(u, 0, 1);
  const f = clamped * TRACK_SAMPLES;
  const idx = Math.min(TRACK_SAMPLES - 1, Math.floor(f));
  const frac = f - idx;
  const a = track.pts[idx];
  const b = track.pts[idx + 1];
  const nx = a.nx + (b.nx - a.nx) * frac;
  const ny = a.ny + (b.ny - a.ny) * frac;
  const nLen = Math.hypot(nx, ny) || 1;
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    nx: nx / nLen,
    ny: ny / nLen
  };
}

function strokeSubTrack(ctx, track, u0, u1) {
  const start = clamp(Math.min(u0, u1), 0, 1);
  const end = clamp(Math.max(u0, u1), 0, 1);
  if (end - start <= 1e-4) return;
  const p0 = evalTrack(track, start);
  const p1 = evalTrack(track, end);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < TRACK_SAMPLES; i++) {
    const u = i / TRACK_SAMPLES;
    if (u > start && u < end) ctx.lineTo(track.pts[i].x, track.pts[i].y);
  }
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

export class TimingGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = TIMING_RULES[session.difficulty];
    const {passes: passCount, zoneWidth, coreWidth, passDur, pause, doublePasses, shapes, moveChance, moveAmp} = this.rules;
    const firstForward = this.direction === 1;
    const leadIn = 0.26;

    const doubleIndices = new Set();
    if (doublePasses > 0) {
      const pool = Array.from({length: passCount}, (_, i) => i).filter(i => i >= 1);
      while (doubleIndices.size < Math.min(doublePasses, pool.length)) {
        const [pick] = pool.splice(Math.floor(this.random() * pool.length), 1);
        doubleIndices.add(pick);
      }
    }

    const rawDurations = Array.from({length: passCount}, (_, i) => {
      const base = passDur * (1 - 0.05 * (i / Math.max(1, passCount - 1)));
      return doubleIndices.has(i) ? Math.max(base, 1.18) : base;
    });
    const available = this.duration - leadIn - pause * (passCount - 1) - 0.14;
    const rawSum = rawDurations.reduce((a, b) => a + b, 0);
    const scale = rawSum > available ? available / rawSum : 1;

    const fixedPrimaryShape = shapes[Math.floor(this.random() * shapes.length)];
    let start = leadIn;
    let prevU = 0.5;
    let prevForward = !firstForward;
    let prevShape = null;
    let sameShapeStreak = 0;
    let zoneId = 0;

    this.passes = rawDurations.map((dur, index) => {
      const length = dur * scale;
      let forward = index === 0 ? firstForward : !prevForward;
      if (this.insane && index > 1 && !doubleIndices.has(index) && this.random() < 0.25) {
        forward = prevForward;
      }
      prevForward = forward;

      let shape;
      if (session.difficulty === "easy") {
        shape = fixedPrimaryShape;
      } else if (session.difficulty === "medium") {
        shape = index === 0 ? fixedPrimaryShape : shapes[Math.floor(this.random() * shapes.length)];
      } else {
        const pool = sameShapeStreak >= 2 ? shapes.filter(s => s !== prevShape) : shapes;
        shape = pool[Math.floor(this.random() * pool.length)];
      }
      sameShapeStreak = shape === prevShape ? sameShapeStreak + 1 : 1;
      prevShape = shape;

      const flip = this.direction;
      const variant = (this.hard || this.insane) && this.random() < 0.55 ? 1 : 0;
      const angle0 = this.between(0, Math.PI * 2);
      const track = buildTrack(shape, flip, variant, angle0);
      const halfU = (zoneWidth / track.length) / 2;
      const coreHalfU = (coreWidth / track.length) / 2;
      const minU = shape === "circle" ? 0.15 : 0.11;
      const maxU = shape === "circle" ? 0.85 : 0.89;

      const makeZone = (u0, maxDrift) => {
        const edgeMargin = Math.min(u0 - minU - halfU - 0.02, maxU - u0 - halfU - 0.02);
        const cap = Math.max(0, Math.min(edgeMargin, maxDrift));
        const moving = cap >= 0.02 && this.random() < moveChance;
        const driftAmp = moving ? Math.min(cap, this.between(...moveAmp)) : 0;
        return {
          id: zoneId++,
          u0,
          halfU,
          coreHalfU,
          driftAmp: driftAmp >= 0.02 ? driftAmp : 0,
          driftFreq: this.between(3.0, 4.8),
          driftPhase: this.between(0, Math.PI * 2)
        };
      };

      const zones = [];
      if (doubleIndices.has(index)) {
        const lowU = this.between(0.22, 0.34);
        const highU = this.between(0.66, 0.78);
        const midMargin = (highU - lowU - halfU * 2 - 0.06) / 2;
        const ordered = forward ? [lowU, highU] : [highU, lowU];
        for (const u of ordered) zones.push(makeZone(u, midMargin));
        prevU = ordered.at(-1);
      } else {
        let u0;
        if (session.difficulty === "easy") {
          u0 = 0.5 + this.between(-0.10, 0.10);
        } else if (session.difficulty === "medium") {
          u0 = this.between(0.24, 0.76);
        } else {
          for (let attempt = 0; attempt < 10; attempt++) {
            u0 = this.between(0.22, 0.78);
            if (Math.abs(u0 - prevU) >= 0.13) break;
          }
        }
        prevU = u0;
        zones.push(makeZone(u0, 0.16));
      }

      const end = start + length;
      const nextStart = end + pause;
      const pass = {start, end, nextStart, forward, track, zones};
      start = nextStart;
      return pass;
    });

    this.totalZones = zoneId;
    this.attempts = new Set();
    this.strikes = [];
    const pt0 = evalTrack(this.passes[0].track, this.passes[0].forward ? 0 : 1);
    this.state.x = pt0.x;
    this.state.y = pt0.y;
  }

  zoneCenterU(zone, time) {
    if (!zone.driftAmp) return zone.u0;
    return zone.u0 + Math.sin(time * zone.driftFreq + zone.driftPhase) * zone.driftAmp;
  }

  sliderAt(time) {
    let index = this.passes.findIndex(pass => time < pass.end);
    if (index === -1) index = this.passes.length - 1;
    const pass = this.passes[index];
    const ratio = clamp((time - pass.start) / (pass.end - pass.start), 0, 1);
    const u = pass.forward ? ratio : 1 - ratio;
    const pos = evalTrack(pass.track, u);
    const activeZones = pass.zones.filter(z => !this.attempts.has(z.id));
    const focus = activeZones[0] ?? pass.zones.at(-1);
    return {
      index, pass, u, pos, zones: pass.zones, focus,
      forward: pass.forward, live: time >= pass.start && time < pass.end
    };
  }

  checkEarlyLoss(time) {
    if (this.result) return;
    const remaining = this.totalZones - this.attempts.size;
    if (this.state.progress + remaining < this.rules.required) {
      this.finish(false, "missed", time);
    }
  }

  press(action, time) {
    if (action !== "timing" || this.result) return;
    const {pass, u, pos, live} = this.sliderAt(time);
    if (!live) return;
    const pending = pass.zones.filter(z => !this.attempts.has(z.id));
    if (!pending.length) return;

    this.state.x = pos.x;
    this.state.y = pos.y;
    const matched = pending.find(z => Math.abs(u - this.zoneCenterU(z, time)) <= z.halfU + 0.008);
    if (matched) {
      this.attempts.add(matched.id);
      this.state.progress++;
      const distU = Math.abs(u - this.zoneCenterU(matched, time));
      const kind = distU <= matched.coreHalfU + 0.004 ? "perfect" : "hit";
      this.strikes.push({x: pos.x, y: pos.y, time, kind});
      this.onEvent("timingHit");
      if (this.state.progress >= this.rules.required) {
        this.finish(true, "timing", time);
      }
      return;
    }

    const missedZone = pending[0];
    this.attempts.add(missedZone.id);
    this.strikes.push({x: pos.x, y: pos.y, time, kind: "miss"});
    this.damage(time, 0.22);
    this.checkEarlyLoss(time);
  }

  update(dt, time) {
    const sl = this.sliderAt(time);
    this.state.x = sl.pos.x;
    this.state.y = sl.pos.y;
    for (const pass of this.passes) {
      if (time < pass.start) continue;
      for (const z of pass.zones) {
        if (this.attempts.has(z.id)) continue;
        const edgeOffset = z.driftAmp + z.halfU + 0.025;
        const pastZone = pass.forward
          ? (time >= pass.end || (sl.pass === pass && sl.u > z.u0 + edgeOffset))
          : (time >= pass.end || (sl.pass === pass && sl.u < z.u0 - edgeOffset));
        if (!pastZone) continue;
        this.attempts.add(z.id);
        const zp = evalTrack(pass.track, this.zoneCenterU(z, time));
        this.strikes.push({x: zp.x, y: zp.y, time, kind: "miss"});
        this.damage(time, 0.22);
        this.checkEarlyLoss(time);
        if (this.result) return;
      }
    }
    if (time >= this.duration) {
      const success = this.state.progress >= this.rules.required;
      this.finish(success, success ? "timing" : "missed", time);
    }
  }

  draw(ctx, time, state, labels = {}) {
    const {index, pass, u, pos, zones, focus, forward, live} = this.sliderAt(time);
    const {track} = pass;
    const cap = track.shape === "circle" ? "butt" : "round";

    // 1. Track ribbon
    ctx.save();
    ctx.lineCap = cap;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(track.pts[0].x, track.pts[0].y);
    for (let i = 1; i < track.pts.length; i++) ctx.lineTo(track.pts[i].x, track.pts[i].y);
    ctx.strokeStyle = "#b78de6";
    ctx.lineWidth = 30;
    ctx.stroke();
    ctx.strokeStyle = "#2b1840";
    ctx.lineWidth = 26;
    ctx.stroke();

    ctx.strokeStyle = "#bd8ae74f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const tk of track.ticks) {
      ctx.moveTo(tk.ax, tk.ay); ctx.lineTo(tk.bx, tk.by);
      ctx.moveTo(tk.cx, tk.cy); ctx.lineTo(tk.dx, tk.dy);
    }
    ctx.stroke();

    // 2. Active zones (layered curved strokes; moving zones carry cyan-gold boundary pips)
    let anyInZone = false;
    ctx.lineCap = "butt";
    for (const z of zones) {
      const done = this.attempts.has(z.id);
      const zc = this.zoneCenterU(z, time);
      ctx.save();
      if (done) ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "#7548ad";
      ctx.lineWidth = 34;
      strokeSubTrack(ctx, track, zc - z.halfU, zc + z.halfU);

      ctx.strokeStyle = "#d4a26a";
      ctx.lineWidth = 34;
      strokeSubTrack(ctx, track, zc - z.halfU * 0.68, zc + z.halfU * 0.68);

      ctx.strokeStyle = "#fcd57c";
      ctx.lineWidth = 34;
      strokeSubTrack(ctx, track, zc - z.coreHalfU, zc + z.coreHalfU);

      ctx.strokeStyle = "#fff8dc99";
      ctx.lineWidth = 34;
      strokeSubTrack(ctx, track, zc - z.coreHalfU * 0.45, zc + z.coreHalfU * 0.45);

      for (const edgeU of [zc - z.halfU, zc + z.halfU]) {
        const ep = evalTrack(track, edgeU);
        ctx.strokeStyle = z.driftAmp ? PALETTE.cyan : "#efc77f";
        ctx.lineWidth = z.driftAmp ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(ep.x - ep.nx * 18, ep.y - ep.ny * 18);
        ctx.lineTo(ep.x + ep.nx * 18, ep.y + ep.ny * 18);
        ctx.stroke();
      }
      ctx.restore();
      if (!done && live && Math.abs(u - zc) <= z.halfU + 0.008) anyInZone = true;
    }

    // 3. Converging rhythm pips around focus zone along track normals
    const focusCenter = this.zoneCenterU(focus, time);
    const focusPt = evalTrack(track, focusCenter);
    const converge = clamp(Math.abs(u - focusCenter) * track.length * 0.28, 3, 46);
    ctx.strokeStyle = anyInZone ? "#fff7c2" : "#fcd57c99";
    ctx.lineWidth = anyInZone ? 2.4 : 1.5;
    for (const side of [-1, 1]) {
      const px = focusPt.x + focusPt.nx * side * (16 + converge);
      const py = focusPt.y + focusPt.ny * side * (16 + converge);
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Strike rings & floating callout labels
    for (const strike of this.strikes) {
      const age = time - strike.time;
      if (age < 0 || age > 0.58) continue;
      const alpha = 1 - age / 0.58;
      const color = strike.kind === "miss" ? PALETTE.crimson : strike.kind === "perfect" ? "#fff9d2" : PALETTE.gold;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (age <= 0.42) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(strike.x, strike.y, 10 + age * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      const text = strike.kind === "perfect" ? (labels.perfect ?? "PERFECT!")
        : strike.kind === "hit" ? (labels.hitOk ?? "HIT!")
        : (labels.miss ?? "MISS");
      ctx.fillStyle = color;
      ctx.font = "800 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(text, clamp(strike.x, 54, WIDTH - 54), clamp(strike.y - 22 - age * 26, 52, HEIGHT - 56));
      ctx.restore();
    }

    // 5. Moving normal-aligned marker + direction chevron
    const glowColor = this.insane ? PALETTE.insane : PALETTE.pink;
    const markerAlpha = (live ? 1 : 0.45) * (time < state.invulnerableUntil && Math.floor(time * 18) % 2 ? 0.35 : 1);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pos.x - pos.nx * 24, pos.y - pos.ny * 24);
    ctx.lineTo(pos.x + pos.nx * 24, pos.y + pos.ny * 24);
    ctx.strokeStyle = glowColor;
    ctx.globalAlpha = markerAlpha * 0.24;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = "#fff9fc";
    ctx.globalAlpha = markerAlpha;
    ctx.lineWidth = 3;
    ctx.stroke();

    const angle = Math.atan2(pos.ny, pos.nx) + Math.PI / 2;
    drawGlow(ctx, pos.x, pos.y, 16, glowColor, 0.42);
    crystal(ctx, pos.x, pos.y, 6, 9, anyInZone ? "#fff9d2" : "#fff7ff", angle);

    if (!live) {
      const cuePt = evalTrack(track, forward ? 0.05 : 0.95);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(forward ? "▶" : "◀", clamp(cuePt.x, 32, WIDTH - 32), clamp(cuePt.y, 52, HEIGHT - 56));
    }
    ctx.restore();

    // 6. Progress crystals & pass indicator
    const spacing = this.totalZones > 7 ? 23 : 27;
    const startX = WIDTH / 2 - ((this.totalZones - 1) / 2) * spacing;
    const reqEndX = startX + (this.rules.required - 1) * spacing + spacing * 0.48;
    ctx.save();
    ctx.strokeStyle = "#fcd57c66";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX - 12, 330);
    ctx.lineTo(startX - 12, 334);
    ctx.lineTo(reqEndX, 334);
    ctx.lineTo(reqEndX, 330);
    ctx.stroke();

    for (let i = 0; i < this.totalZones; i++) {
      const cx = startX + i * spacing;
      const filled = i < state.progress;
      const optional = i >= this.rules.required;
      crystal(ctx, cx, 314, 7, 9, filled ? PALETTE.gold : optional ? "#3a2d4a" : "#5e4a73");
    }

    ctx.fillStyle = "#d9c2ef";
    ctx.font = "600 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${index + 1} / ${this.passes.length}`, WIDTH / 2, 36);
    ctx.restore();
  }
}
