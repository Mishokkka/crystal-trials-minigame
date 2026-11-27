import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal, drawGlow} from "./base.js";

const BAR = {x: 48, y: 164, width: 384, height: 34};
export const TIMING_RULES = {
  easy: {passes: 4, count: 4, required: 3, zoneWidth: 86, coreWidth: 26, passDur: 1.60, pause: 0.20, doublePasses: 0},
  medium: {passes: 5, count: 5, required: 4, zoneWidth: 64, coreWidth: 20, passDur: 1.36, pause: 0.20, doublePasses: 0},
  hard: {passes: 5, count: 7, required: 5, zoneWidth: 50, coreWidth: 16, passDur: 1.36, pause: 0.18, doublePasses: 2},
  insane: {passes: 6, count: 9, required: 7, zoneWidth: 42, coreWidth: 14, passDur: 1.20, pause: 0.14, doublePasses: 3}
};

export class TimingGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = TIMING_RULES[session.difficulty];
    const {passes: passCount, zoneWidth, coreWidth, passDur, pause, doublePasses} = this.rules;
    const firstForward = this.direction === 1;
    const leadIn = 0.26;

    // Pick which passes carry double target zones (prefer middle/late passes)
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

    let start = leadIn;
    let prevCenter = WIDTH / 2;
    let prevForward = !firstForward;
    let zoneId = 0;

    this.passes = rawDurations.map((dur, index) => {
      const length = dur * scale;
      let forward = index === 0 ? firstForward : !prevForward;
      if (this.insane && index > 1 && !doubleIndices.has(index) && this.random() < 0.25) {
        forward = prevForward;
      }
      prevForward = forward;

      const zones = [];
      if (doubleIndices.has(index)) {
        const c1 = this.between(BAR.x + 58, BAR.x + 120);
        const c2 = this.between(Math.max(c1 + 132, BAR.x + 256), BAR.x + BAR.width - 58);
        const ordered = forward ? [c1, c2] : [c2, c1];
        for (const c of ordered) {
          zones.push({id: zoneId++, center: c, width: zoneWidth, coreWidth});
        }
        prevCenter = ordered.at(-1);
      } else {
        let center;
        if (session.difficulty === "easy") {
          center = WIDTH / 2 + this.between(-36, 36);
        } else if (session.difficulty === "medium") {
          center = this.between(BAR.x + 86, BAR.x + BAR.width - 86);
        } else {
          for (let attempt = 0; attempt < 10; attempt++) {
            center = this.between(BAR.x + 76, BAR.x + BAR.width - 76);
            if (Math.abs(center - prevCenter) >= 44) break;
          }
        }
        prevCenter = center;
        zones.push({id: zoneId++, center, width: zoneWidth, coreWidth});
      }

      const end = start + length;
      const nextStart = end + pause;
      const pass = {start, end, nextStart, forward, zones};
      start = nextStart;
      return pass;
    });

    this.totalZones = zoneId;
    this.attempts = new Set();
    this.strikes = [];
    this.state.x = this.sliderAt(0).x;
  }

  sliderAt(time) {
    let index = this.passes.findIndex(pass => time < pass.end);
    if (index === -1) index = this.passes.length - 1;
    const pass = this.passes[index];
    const ratio = clamp((time - pass.start) / (pass.end - pass.start), 0, 1);
    const x = BAR.x + BAR.width * (pass.forward ? ratio : 1 - ratio);
    const activeZones = pass.zones.filter(z => !this.attempts.has(z.id));
    const focus = activeZones[0] ?? pass.zones.at(-1);
    return {
      index, pass, x, zones: pass.zones, center: focus.center, width: focus.width,
      coreWidth: focus.coreWidth, forward: pass.forward, live: time >= pass.start && time < pass.end
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
    const {pass, x, live} = this.sliderAt(time);
    if (!live) return;
    const pending = pass.zones.filter(z => !this.attempts.has(z.id));
    if (!pending.length) return;

    this.state.x = x;
    const matched = pending.find(z => Math.abs(x - z.center) <= z.width / 2);
    if (matched) {
      this.attempts.add(matched.id);
      this.state.progress++;
      const kind = Math.abs(x - matched.center) <= matched.coreWidth / 2 ? "perfect" : "hit";
      this.strikes.push({x, time, kind});
      this.onEvent("timingHit");
      if (this.state.progress >= this.rules.required) {
        this.finish(true, "timing", time);
      }
      return;
    }

    const missedZone = pending[0];
    this.attempts.add(missedZone.id);
    this.strikes.push({x, time, kind: "miss"});
    this.damage(time, 0.22);
    this.checkEarlyLoss(time);
  }

  update(dt, time) {
    const sl = this.sliderAt(time);
    this.state.x = sl.x;
    for (const pass of this.passes) {
      if (time < pass.start) continue;
      for (const z of pass.zones) {
        if (this.attempts.has(z.id)) continue;
        const pastZone = pass.forward
          ? (time >= pass.end || (sl.pass === pass && sl.x > z.center + z.width / 2 + 5))
          : (time >= pass.end || (sl.pass === pass && sl.x < z.center - z.width / 2 - 5));
        if (!pastZone) continue;
        this.attempts.add(z.id);
        this.strikes.push({x: z.center, time, kind: "miss"});
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
    const {index, x, zones, center, width, forward, live} = this.sliderAt(time);
    ctx.save();
    ctx.fillStyle = "#2b1840";
    ctx.strokeStyle = "#b78de6";
    ctx.lineWidth = 1.5;
    ctx.fillRect(BAR.x, BAR.y, BAR.width, BAR.height);
    ctx.strokeRect(BAR.x, BAR.y, BAR.width, BAR.height);

    ctx.strokeStyle = "#bd8ae74f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 16; i++) {
      const tick = BAR.x + i * BAR.width / 16;
      ctx.moveTo(tick, BAR.y);
      ctx.lineTo(tick, BAR.y + 6);
      ctx.moveTo(tick, BAR.y + BAR.height - 6);
      ctx.lineTo(tick, BAR.y + BAR.height);
    }
    ctx.stroke();

    // Draw all zones on current pass
    let anyInZone = false;
    for (const z of zones) {
      const done = this.attempts.has(z.id);
      const zoneX = z.center - z.width / 2;
      const bandW = z.width * 0.68;
      ctx.save();
      if (done) ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#7548ad";
      ctx.fillRect(zoneX, BAR.y - 3, z.width, BAR.height + 6);
      ctx.fillStyle = "#d4a26a";
      ctx.fillRect(z.center - bandW / 2, BAR.y - 3, bandW, BAR.height + 6);
      ctx.fillStyle = "#fcd57c";
      ctx.fillRect(z.center - z.coreWidth / 2, BAR.y - 3, z.coreWidth, BAR.height + 6);
      ctx.fillStyle = "#fff8dc99";
      ctx.fillRect(z.center - z.coreWidth * 0.35, BAR.y - 3, z.coreWidth * 0.7, BAR.height + 6);
      ctx.strokeStyle = "#efc77f";
      ctx.strokeRect(zoneX, BAR.y - 3, z.width, BAR.height + 6);
      ctx.restore();
      if (!done && live && Math.abs(x - z.center) <= z.width / 2) anyInZone = true;
    }

    // Converging rhythm chevrons around next pending zone
    const converge = clamp(Math.abs(x - center) * 0.28, 3, 56);
    ctx.strokeStyle = anyInZone ? "#fff7c2" : "#fcd57c99";
    ctx.lineWidth = anyInZone ? 2.5 : 1.5;
    for (const dir of [-1, 1]) {
      const cx = center + dir * converge;
      ctx.beginPath();
      ctx.moveTo(cx + dir * 6, BAR.y - 17);
      ctx.lineTo(cx, BAR.y - 10);
      ctx.lineTo(cx + dir * 6, BAR.y - 3);
      ctx.moveTo(cx + dir * 6, BAR.y + BAR.height + 17);
      ctx.lineTo(cx, BAR.y + BAR.height + 10);
      ctx.lineTo(cx + dir * 6, BAR.y + BAR.height + 3);
      ctx.stroke();
    }

    // Strike rings & floating callout labels
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
        ctx.arc(strike.x, BAR.y + BAR.height / 2, 10 + age * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      const text = strike.kind === "perfect" ? (labels.perfect ?? "PERFECT!")
        : strike.kind === "hit" ? (labels.hitOk ?? "HIT!")
        : (labels.miss ?? "MISS");
      ctx.fillStyle = color;
      ctx.font = "800 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(text, clamp(strike.x, 54, WIDTH - 54), BAR.y - 20 - age * 28);
      ctx.restore();
    }

    // Moving marker + direction arrow
    const glowColor = this.insane ? PALETTE.insane : PALETTE.pink;
    const markerAlpha = (live ? 1 : 0.45) * (time < state.invulnerableUntil && Math.floor(time * 18) % 2 ? 0.35 : 1);
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = markerAlpha * 0.24;
    ctx.fillRect(x - 5.5, BAR.y - 14, 11, BAR.height + 28);
    ctx.fillStyle = "#fff9fc";
    ctx.globalAlpha = markerAlpha;
    ctx.fillRect(x - 1.5, BAR.y - 14, 3, BAR.height + 28);
    drawGlow(ctx, x, BAR.y + BAR.height / 2, 16, glowColor, 0.42);
    crystal(ctx, x, BAR.y + BAR.height / 2, 6, 9, anyInZone ? "#fff9d2" : "#fff7ff");

    if (!live) {
      const arrowX = forward ? BAR.x + 14 : BAR.x + BAR.width - 14;
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(forward ? "▶" : "◀", arrowX, BAR.y + BAR.height / 2 + 5);
    }
    ctx.restore();

    // Progress crystals + required threshold bracket
    const spacing = this.totalZones > 7 ? 23 : 27;
    const startX = WIDTH / 2 - ((this.totalZones - 1) / 2) * spacing;
    const reqEndX = startX + (this.rules.required - 1) * spacing + spacing * 0.48;
    ctx.save();
    ctx.strokeStyle = "#fcd57c66";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX - 12, BAR.y + 104);
    ctx.lineTo(startX - 12, BAR.y + 108);
    ctx.lineTo(reqEndX, BAR.y + 108);
    ctx.lineTo(reqEndX, BAR.y + 104);
    ctx.stroke();

    for (let i = 0; i < this.totalZones; i++) {
      const cx = startX + i * spacing;
      const filled = i < state.progress;
      const optional = i >= this.rules.required;
      crystal(ctx, cx, BAR.y + 86, 7, 9, filled ? PALETTE.gold : optional ? "#3a2d4a" : "#5e4a73");
    }

    ctx.fillStyle = "#d9c2ef";
    ctx.font = "600 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${index + 1} / ${this.passes.length}`, WIDTH / 2, BAR.y - 44);
    ctx.restore();
  }
}
