import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, crystal, drawSoul} from "./base.js";

const LEVELS = {
  easy: {
    moveSpeed: 220, telegraph: 0.62, speed: [145, 210], bursts: [1.05, 1.35],
    count: [3, 4], crossChance: 0.25, fanChance: 0.25, boulderChance: 0.15, needleChance: 0.10
  },
  medium: {
    moveSpeed: 234, telegraph: 0.52, speed: [185, 270], bursts: [0.78, 1.05],
    count: [4, 6], crossChance: 0.45, fanChance: 0.35, boulderChance: 0.20, needleChance: 0.22
  },
  hard: {
    moveSpeed: 252, telegraph: 0.44, speed: [235, 345], bursts: [0.58, 0.80],
    count: [5, 8], crossChance: 0.65, fanChance: 0.40, boulderChance: 0.22, needleChance: 0.32
  },
  insane: {
    moveSpeed: 270, telegraph: 0.37, speed: [285, 420], bursts: [0.44, 0.64],
    count: [7, 10], crossChance: 0.80, fanChance: 0.45, boulderChance: 0.22, needleChance: 0.42
  }
};

const MIN_ENTRY_SPACING = 42;

function edgePoint(side, along) {
  if (side === 0) return {x: 0, y: along, baseAngle: 0, span: HEIGHT};
  if (side === 1) return {x: WIDTH, y: along, baseAngle: Math.PI, span: HEIGHT};
  if (side === 2) return {x: along, y: 0, baseAngle: Math.PI / 2, span: WIDTH};
  return {x: along, y: HEIGHT, baseAngle: -Math.PI / 2, span: WIDTH};
}

function exitDistance(x, y, ux, uy) {
  const tx = ux > 1e-4 ? (WIDTH - x) / ux : ux < -1e-4 ? -x / ux : Infinity;
  const ty = uy > 1e-4 ? (HEIGHT - y) / uy : uy < -1e-4 ? -y / uy : Infinity;
  return Math.min(tx, ty);
}

export class ShardsGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.shards = [];
    this.buildStorm();
    this.cues.sort((a, b) => a.time - b.time);
  }

  pickKind() {
    const roll = this.random();
    if (roll < this.cfg.needleChance) return "needle";
    if (roll < this.cfg.needleChance + this.cfg.boulderChance) return "boulder";
    return "normal";
  }

  addShard(side, along, spread, spawn, speedScale = 1, kind = this.pickKind()) {
    const edge = edgePoint(side, along);
    const angle = edge.baseAngle + spread;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let radius = this.between(7.5, 9.5);
    let length = radius + 6;
    let speed = this.between(...this.cfg.speed) * speedScale;
    let color = PALETTE.lilac;
    if (kind === "needle") {
      radius = this.between(5.5, 7);
      length = radius + 10;
      speed *= 1.22;
      color = this.insane ? PALETTE.insane : PALETTE.pink;
    } else if (kind === "boulder") {
      radius = this.between(12, 14.5);
      length = radius + 4;
      speed *= 0.74;
      color = PALETTE.violet;
    }
    const offsetOut = length + 14;
    const x0 = edge.x - ux * offsetOut;
    const y0 = edge.y - uy * offsetOut;
    const travel = exitDistance(edge.x, edge.y, ux, uy) + offsetOut * 2;
    this.shards.push({
      cue: Math.max(0.05, spawn - this.cfg.telegraph),
      spawn,
      end: spawn + travel / speed,
      entryX: edge.x,
      entryY: edge.y,
      x0, y0,
      ux, uy,
      vx: ux * speed,
      vy: uy * speed,
      speed,
      radius,
      length,
      angle,
      color,
      kind
    });
  }

  pickSpacedAlong(side, used) {
    const span = side < 2 ? HEIGHT : WIDTH;
    const margin = 26;
    let best = this.between(margin, span - margin);
    let bestDist = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = this.between(margin, span - margin);
      const nearest = used.reduce((min, pos) => Math.min(min, Math.abs(candidate - pos)), Infinity);
      if (nearest >= MIN_ENTRY_SPACING) {
        used.push(candidate);
        return candidate;
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = candidate;
      }
    }
    used.push(best);
    return best;
  }

  buildFanBurst(burstStart) {
    const side = Math.floor(this.random() * 4);
    const span = side < 2 ? HEIGHT : WIDTH;
    const rays = this.insane ? (this.random() < 0.5 ? 6 : 5) : this.hard ? 5 : 4;
    const cornerBias = (this.hard || this.insane) && this.random() < 0.45;
    const anchor = cornerBias
      ? (this.random() < 0.5 ? this.between(24, 58) : this.between(span - 58, span - 24))
      : this.between(span * 0.25, span * 0.75);
    const centerBias = (anchor / span - 0.5) * (side === 0 || side === 3 ? -0.45 : 0.45);
    const halfArc = this.between(0.48, 0.66);
    const baseSpeedScale = this.between(0.92, 1.08);
    for (let i = 0; i < rays; i++) {
      const frac = rays === 1 ? 0.5 : i / (rays - 1);
      const spread = centerBias + (frac - 0.5) * 2 * halfArc;
      const clampedSpread = clamp(spread, -0.74, 0.74);
      const stagger = i * this.between(0, 0.035);
      this.addShard(side, anchor, clampedSpread, burstStart + stagger, baseSpeedScale, this.pickKind());
    }
  }

  buildScatteredBurst(burstStart) {
    const side1 = Math.floor(this.random() * 4);
    const cross = this.random() < this.cfg.crossChance;
    const altSides = [0, 1, 2, 3].filter(s => s !== side1);
    const side2 = altSides[Math.floor(this.random() * altSides.length)];
    const total = Math.round(this.between(...this.cfg.count));
    const usedBySide = new Map([[0, []], [1, []], [2, []], [3, []]]);
    for (let i = 0; i < total; i++) {
      const useSecond = cross && i % 2 === 1;
      const side = useSecond ? side2 : side1;
      const along = this.pickSpacedAlong(side, usedBySide.get(side));
      const spread = this.between(-0.38, 0.38);
      const delay = i === 0 ? 0 : (useSecond ? this.between(0.08, 0.30) : this.between(0, 0.34));
      this.addShard(side, along, spread, burstStart + delay);
    }
  }

  buildStorm() {
    let burstStart = 0.72;
    while (burstStart < this.duration - 0.55) {
      this.cues.push({time: Math.max(0.05, burstStart - this.cfg.telegraph), sound: "ShardWave"});
      if (this.random() < this.cfg.fanChance) this.buildFanBurst(burstStart);
      else this.buildScatteredBurst(burstStart);
      burstStart += this.between(...this.cfg.bursts);
    }
  }

  update(dt, time, input) {
    this.moveFree(dt, input, this.cfg.moveSpeed, time);
    const sx = this.state.x;
    const sy = this.state.y;
    for (const shard of this.shards) {
      if (time < shard.spawn || time >= shard.end) continue;
      const elapsed = time - shard.spawn;
      const px = shard.x0 + shard.vx * elapsed;
      const py = shard.y0 + shard.vy * elapsed;
      if (Math.hypot(sx - px, sy - py) < shard.radius * 0.78 + SOUL_RADIUS - 1.5) {
        this.damage(time);
      }
    }
  }

  draw(ctx, time, state) {
    for (const shard of this.shards) {
      if (time < shard.cue || time >= shard.end) continue;
      if (time < shard.spawn) {
        const progress = clamp((time - shard.cue) / (shard.spawn - shard.cue), 0, 1);
        const ix = clamp(shard.entryX, 5, WIDTH - 5);
        const iy = clamp(shard.entryY, 5, HEIGHT - 5);
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.65 * progress;
        ctx.strokeStyle = shard.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix + shard.ux * (26 + progress * 10), iy + shard.uy * (26 + progress * 10));
        ctx.stroke();
        ctx.setLineDash([]);
        crystal(ctx, ix, iy, 4 + progress * 2, 4 + progress * 2, shard.color, shard.angle);
        ctx.restore();
        continue;
      }
      const elapsed = time - shard.spawn;
      const px = shard.x0 + shard.vx * elapsed;
      const py = shard.y0 + shard.vy * elapsed;
      const tailLen = Math.min(36, shard.speed * 0.085);
      const tx = px - shard.ux * tailLen;
      const ty = py - shard.uy * tailLen;
      ctx.save();
      const grad = ctx.createLinearGradient(tx, ty, px, py);
      grad.addColorStop(0, "transparent");
      grad.addColorStop(1, `${shard.color}88`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = shard.radius * 0.85;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
      crystal(ctx, px, py, shard.radius, shard.length, shard.color, shard.angle + Math.PI / 2);
    }
    drawSoul(ctx, state, time);
  }
}
