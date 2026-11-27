import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal, drawGlow} from "./base.js";

export const AIM_RULES = {
  easy: {count: 6, required: 5, radius: 28, lifetime: 1.55, decoyCount: 0},
  medium: {count: 8, required: 7, radius: 24, lifetime: 1.25, decoyCount: 1},
  hard: {count: 10, required: 8, radius: 21, lifetime: 1.02, decoyCount: 3},
  insane: {count: 13, required: 11, radius: 18, lifetime: 0.84, decoyCount: 4}
};

export class AimGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = AIM_RULES[session.difficulty];
    this.targets = [];
    this.buildTargets();
  }

  pickFreePoint(spawn, end, minDist) {
    const padX = 58;
    const padY = 56;
    const concurrent = this.targets.filter(t => t.spawn <= end + 0.2 && t.end >= spawn - 0.2);
    let best = {x: this.between(padX, WIDTH - padX), y: this.between(padY, HEIGHT - padY)};
    let bestMin = -1;
    for (let attempt = 0; attempt < 25; attempt++) {
      const pt = {x: this.between(padX, WIDTH - padX), y: this.between(padY, HEIGHT - padY)};
      const nearest = concurrent.reduce((m, t) => Math.min(m, Math.hypot(pt.x - t.x, pt.y - t.y)), Infinity);
      if (nearest >= minDist) return pt;
      if (nearest > bestMin) {
        bestMin = nearest;
        best = pt;
      }
    }
    return best;
  }

  buildTargets() {
    const {count, radius, lifetime, decoyCount} = this.rules;
    const firstSpawn = 0.40;
    const lastSpawn = Math.max(firstSpawn + 0.5, this.duration - lifetime - 0.25);
    const step = count > 1 ? (lastSpawn - firstSpawn) / (count - 1) : 0;
    const minDist = radius * 3.0;

    for (let i = 0; i < count; i++) {
      const baseSpawn = firstSpawn + i * step;
      const jitter = i === 0 || i === count - 1 ? 0 : this.between(-0.08, 0.08);
      const spawn = clamp(baseSpawn + jitter, 0.30, lastSpawn);
      const end = spawn + lifetime;
      const pt = this.pickFreePoint(spawn, end, minDist);
      this.targets.push({id: i, x: pt.x, y: pt.y, spawn, end, decoy: false, struck: false, resolved: false});
    }

    for (let d = 0; d < decoyCount; d++) {
      const host = this.targets[Math.min(count - 1, Math.floor((d + 0.5) * count / decoyCount))];
      const spawn = Math.max(0.35, host.spawn - 0.08);
      const end = Math.min(this.duration - 0.20, spawn + lifetime * 1.08);
      const pt = this.pickFreePoint(spawn, end, minDist);
      this.targets.push({id: count + d, x: pt.x, y: pt.y, spawn, end, decoy: true, struck: false, resolved: false});
    }
  }

  movePointer(point) {
    if (this.result) return;
    this.state.x = point.x;
    this.state.y = point.y;
    this.state.moving = true;
  }

  clickPointer(point, time) {
    if (this.result) return;
    this.state.x = point.x;
    this.state.y = point.y;

    let hit = null;
    let bestDist = Infinity;
    for (const t of this.targets) {
      if (t.struck || t.resolved || time < t.spawn || time >= t.end) continue;
      const d = Math.hypot(point.x - t.x, point.y - t.y);
      if (d <= this.rules.radius + 5 && d < bestDist) {
        bestDist = d;
        hit = t;
      }
    }
    if (!hit) return;

    hit.struck = true;
    hit.resolved = true;
    if (hit.decoy) {
      this.damage(time, 0.30);
      return;
    }

    this.state.progress++;
    this.onEvent("timingHit");
    if (this.state.progress >= this.rules.required) {
      this.finish(true, "aim", time);
    }
  }

  syncSpectatorStrike(x, y, time) {
    let best = null;
    let bestDist = Infinity;
    for (const t of this.targets) {
      if (t.struck || time < t.spawn - 0.15 || time > t.end + 0.15) continue;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= this.rules.radius + 14 && d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best) best.struck = true;
  }

  update(dt, time) {
    for (const t of this.targets) {
      if (t.resolved || time < t.end) continue;
      t.resolved = true;
      if (!t.decoy && !t.struck) {
        this.damage(time, 0.25);
        const remainingNormal = this.targets.filter(item => !item.decoy && !item.resolved).length;
        if (!this.result && this.state.progress + remainingNormal < this.rules.required) {
          this.finish(false, "missed", time);
          return;
        }
      }
    }
    if (time >= this.duration) {
      const ok = this.state.progress >= this.rules.required;
      this.finish(ok, ok ? "aim" : "missed", time);
    }
  }

  draw(ctx, time, state) {
    const r = this.rules.radius;
    for (const t of this.targets) {
      if (t.struck || time < t.spawn || time >= t.end) continue;
      const frac = clamp((time - t.spawn) / (t.end - t.spawn), 0, 1);
      const outerR = r * (2.1 - 1.1 * frac);

      ctx.save();
      if (t.decoy) {
        ctx.strokeStyle = PALETTE.crimson;
        ctx.fillStyle = "#9f123966";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "#fda4af";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(t.x - 7, t.y - 7); ctx.lineTo(t.x + 7, t.y + 7);
        ctx.moveTo(t.x + 7, t.y - 7); ctx.lineTo(t.x - 7, t.y + 7);
        ctx.stroke();
      } else {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.45 + 0.55 * frac;
        ctx.beginPath();
        ctx.arc(t.x, t.y, outerR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 1;
        drawGlow(ctx, t.x, t.y, r * 1.65, PALETTE.gold, 0.42);
        ctx.fillStyle = "#3b1d5fcc";
        ctx.strokeStyle = "#fde68a";
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        crystal(ctx, t.x, t.y, r * 0.38, r * 0.50, PALETTE.gold);
      }
      ctx.restore();
    }

    // Aiming reticle
    ctx.save();
    ctx.strokeStyle = PALETTE.pink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(state.x, state.y, 10, 0, Math.PI * 2);
    ctx.moveTo(state.x - 14, state.y); ctx.lineTo(state.x - 6, state.y);
    ctx.moveTo(state.x + 6, state.y); ctx.lineTo(state.x + 14, state.y);
    ctx.moveTo(state.x, state.y - 14); ctx.lineTo(state.x, state.y - 6);
    ctx.moveTo(state.x, state.y + 6); ctx.lineTo(state.x, state.y + 14);
    ctx.stroke();
    ctx.restore();
  }
}
