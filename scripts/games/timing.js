import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal} from "./base.js";

const BAR = {x: 48, y: 164, width: 384, height: 34};
export const TIMING_RULES = {
  easy: {count: 4, required: 3, zoneWidth: 88, coreWidth: 26, passDur: 1.62, pause: 0.20, accel: 0.04},
  medium: {count: 5, required: 4, zoneWidth: 66, coreWidth: 20, passDur: 1.38, pause: 0.20, accel: 0.06},
  hard: {count: 6, required: 5, zoneWidth: 50, coreWidth: 16, passDur: 1.18, pause: 0.18, accel: 0.08},
  insane: {count: 8, required: 7, zoneWidth: 42, coreWidth: 14, passDur: 1.00, pause: 0.14, accel: 0.09}
};

export class TimingGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = TIMING_RULES[session.difficulty];
    const {count, zoneWidth, coreWidth, passDur, pause, accel} = this.rules;
    const firstForward = this.direction === 1;
    const leadIn = 0.28;
    const rawDurations = Array.from({length: count}, (_, i) =>
      passDur * (1 - accel * (i / Math.max(1, count - 1)))
    );
    const available = this.duration - leadIn - pause * (count - 1) - 0.15;
    const rawSum = rawDurations.reduce((a, b) => a + b, 0);
    const scale = rawSum > available ? available / rawSum : 1;

    let start = leadIn;
    let prevCenter = WIDTH / 2;
    let prevForward = !firstForward;
    this.passes = rawDurations.map((dur, index) => {
      const length = dur * scale;
      let forward = index === 0 ? firstForward : !prevForward;
      if (this.insane && index > 1 && this.random() < 0.25) forward = prevForward;
      prevForward = forward;

      let center;
      if (session.difficulty === "easy") {
        center = WIDTH / 2 + this.between(-36, 36);
      } else if (session.difficulty === "medium") {
        center = this.between(BAR.x + 88, BAR.x + BAR.width - 88);
      } else {
        for (let attempt = 0; attempt < 10; attempt++) {
          center = this.between(BAR.x + 76, BAR.x + BAR.width - 76);
          if (Math.abs(center - prevCenter) >= 45) break;
        }
      }
      prevCenter = center;
      const end = start + length;
      const nextStart = end + pause;
      const pass = {start, end, nextStart, forward, center, width: zoneWidth, coreWidth};
      start = nextStart;
      return pass;
    });

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
    return {
      index, x, center: pass.center, width: pass.width, coreWidth: pass.coreWidth,
      forward: pass.forward, live: time >= pass.start && time < pass.end
    };
  }

  checkEarlyLoss(time) {
    if (this.result) return;
    const remaining = this.rules.count - this.attempts.size;
    if (this.state.progress + remaining < this.rules.required) {
      this.finish(false, "missed", time);
    }
  }

  press(action, time) {
    if (action !== "timing" || this.result) return;
    const {index, x, center, width, coreWidth, live} = this.sliderAt(time);
    if (!live || this.attempts.has(index)) return;
    this.attempts.add(index);
    this.state.x = x;
    const delta = Math.abs(x - center);
    if (delta <= width / 2) {
      this.state.progress++;
      const kind = delta <= coreWidth / 2 ? "perfect" : "hit";
      this.strikes.push({index, x, time, kind});
      this.onEvent("timingHit");
      if (this.state.progress >= this.rules.required) {
        this.finish(true, "timing", time);
      }
    } else {
      this.strikes.push({index, x, time, kind: "miss"});
      this.damage(time, 0.25);
      this.checkEarlyLoss(time);
    }
  }

  update(dt, time) {
    this.state.x = this.sliderAt(time).x;
    for (let i = 0; i < this.passes.length; i++) {
      if (time < this.passes[i].end || this.attempts.has(i)) continue;
      this.attempts.add(i);
      this.strikes.push({index: i, x: this.state.x, time, kind: "miss"});
      this.damage(time, 0.25);
      this.checkEarlyLoss(time);
      if (this.result) return;
    }
    if (time >= this.duration) {
      const success = this.state.progress >= this.rules.required;
      this.finish(success, success ? "timing" : "missed", time);
    }
  }

  draw(ctx, time, state) {
    const {index, x, center, width, coreWidth, forward, live} = this.sliderAt(time);
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

    // Target golden zone + perfect inner core
    const zoneX = center - width / 2;
    const gradient = ctx.createLinearGradient(zoneX, 0, zoneX + width, 0);
    gradient.addColorStop(0, "#7548ad");
    gradient.addColorStop(0.5, "#fcd57c");
    gradient.addColorStop(1, "#7548ad");
    ctx.fillStyle = gradient;
    ctx.fillRect(zoneX, BAR.y - 3, width, BAR.height + 6);
    ctx.strokeStyle = "#efc77f";
    ctx.strokeRect(zoneX, BAR.y - 3, width, BAR.height + 6);

    const coreX = center - coreWidth / 2;
    ctx.fillStyle = "#fff8dc99";
    ctx.fillRect(coreX, BAR.y - 3, coreWidth, BAR.height + 6);

    // Converging rhythm chevrons around target center
    const dist = Math.abs(x - center);
    const converge = clamp(dist * 0.28, 3, 56);
    const inZone = dist <= width / 2 && live;
    ctx.strokeStyle = inZone ? "#fff7c2" : "#fcd57c99";
    ctx.lineWidth = inZone ? 2.5 : 1.5;
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

    // Recent strike rings
    for (const strike of this.strikes) {
      const age = time - strike.time;
      if (age < 0 || age > 0.45) continue;
      const alpha = 1 - age / 0.45;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = strike.kind === "miss" ? PALETTE.crimson : strike.kind === "perfect" ? "#fff9d2" : PALETTE.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(strike.x, BAR.y + BAR.height / 2, 10 + age * 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Moving marker + direction indicator
    ctx.globalAlpha = live ? 1 : 0.45;
    if (time < state.invulnerableUntil && Math.floor(time * 18) % 2) ctx.globalAlpha *= 0.35;
    ctx.fillStyle = "#fff9fc";
    ctx.shadowColor = this.insane ? PALETTE.insane : PALETTE.pink;
    ctx.shadowBlur = 18;
    ctx.fillRect(x - 1.5, BAR.y - 14, 3, BAR.height + 28);
    crystal(ctx, x, BAR.y + BAR.height / 2, 6, 9, inZone ? "#fff9d2" : "#fff7ff");
    ctx.shadowBlur = 0;

    // Direction arrow near edge before pass goes live
    if (!live) {
      const arrowX = forward ? BAR.x + 14 : BAR.x + BAR.width - 14;
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(forward ? "▶" : "◀", arrowX, BAR.y + BAR.height / 2 + 5);
    }
    ctx.restore();

    // Progress crystals + required threshold bracket
    const spacing = this.rules.count > 6 ? 24 : 28;
    const startX = WIDTH / 2 - ((this.rules.count - 1) / 2) * spacing;
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

    for (let i = 0; i < this.rules.count; i++) {
      const cx = startX + i * spacing;
      const filled = i < state.progress;
      const optional = i >= this.rules.required;
      crystal(ctx, cx, BAR.y + 86, 7, 9, filled ? PALETTE.gold : optional ? "#3a2d4a" : "#5e4a73");
    }

    ctx.fillStyle = "#d9c2ef";
    ctx.font = "600 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${index + 1} / ${this.rules.count}`, WIDTH / 2, BAR.y - 34);
    ctx.restore();
  }
}
