import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal, drawGlow} from "./base.js";

export const AIM_RULES = {
  easy: {
    count: 8, required: 6, radius: 26, lifetime: 1.45, decoyCount: 0,
    moveChance: 0.15, moveSpeed: [40, 65], burstChance: 0, doubleChance: 0, shrinkChance: 0
  },
  medium: {
    count: 12, required: 10, radius: 23, lifetime: 1.18, decoyCount: 2,
    moveChance: 0.38, moveSpeed: [65, 105], burstChance: 0.22, doubleChance: 0.12, shrinkChance: 0
  },
  hard: {
    count: 17, required: 14, radius: 20, lifetime: 0.96, decoyCount: 4,
    moveChance: 0.58, moveSpeed: [95, 150], burstChance: 0.35, doubleChance: 0.22, shrinkChance: 0.25
  },
  insane: {
    count: 23, required: 19, radius: 17.5, lifetime: 0.78, decoyCount: 6,
    moveChance: 0.75, moveSpeed: [130, 195], burstChance: 0.48, doubleChance: 0.30, shrinkChance: 0.40
  }
};

const PAD_X = 50;
const PAD_Y = 50;

function reflect(val, min, max) {
  const span = max - min;
  if (span <= 0) return min;
  let m = (val - min) % (span * 2);
  if (m < 0) m += span * 2;
  return m <= span ? min + m : max - (m - span);
}

export class AimGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = AIM_RULES[session.difficulty];
    this.targets = [];
    this.pops = [];
    this.state.aimStruck = 0;
    this.state.aimCracked = 0;
    this.buildTargets();
  }

  posAt(target, time) {
    const age = Math.max(0, time - target.spawn);
    if (target.moveKind === "drift") {
      return {
        x: reflect(target.x0 + target.vx * age, PAD_X, WIDTH - PAD_X),
        y: reflect(target.y0 + target.vy * age, PAD_Y, HEIGHT - PAD_Y)
      };
    }
    if (target.moveKind === "orbit") {
      const a = target.orbitA0 + target.orbitOmega * age;
      return {
        x: target.cx + Math.cos(a) * target.orbitR,
        y: target.cy + Math.sin(a) * target.orbitR
      };
    }
    return {x: target.x0, y: target.y0};
  }

  radiusAt(target, time) {
    if (target.decoy) return this.rules.radius * 0.84;
    if (!target.shrink) return this.rules.radius;
    const frac = clamp((time - target.spawn) / (target.end - target.spawn), 0, 1);
    return this.rules.radius * (1.16 - 0.48 * frac);
  }

  pickFreePoint(spawn, end, minDist) {
    const mid = (spawn + end) * 0.5;
    const concurrent = this.targets.filter(t => t.spawn <= end + 0.18 && t.end >= spawn - 0.18);
    let best = {x: this.between(PAD_X + 8, WIDTH - PAD_X - 8), y: this.between(PAD_Y + 6, HEIGHT - PAD_Y - 6)};
    let bestMin = -1;
    for (let attempt = 0; attempt < 24; attempt++) {
      const pt = {x: this.between(PAD_X + 8, WIDTH - PAD_X - 8), y: this.between(PAD_Y + 6, HEIGHT - PAD_Y - 6)};
      let nearest = Infinity;
      for (const other of concurrent) {
        const p0 = this.posAt(other, spawn);
        const pm = this.posAt(other, mid);
        nearest = Math.min(nearest, Math.hypot(pt.x - p0.x, pt.y - p0.y), Math.hypot(pt.x - pm.x, pt.y - pm.y));
      }
      if (nearest >= minDist) return pt;
      if (nearest > bestMin) {
        bestMin = nearest;
        best = pt;
      }
    }
    return best;
  }

  makeMotion(pt, isDecoy, allowOrbit) {
    const chance = isDecoy ? (this.hard || this.insane ? 0.45 : 0) : this.rules.moveChance;
    if (this.random() >= chance) {
      return {moveKind: "static", x0: pt.x, y0: pt.y, vx: 0, vy: 0, cx: pt.x, cy: pt.y, orbitR: 0, orbitA0: 0, orbitOmega: 0};
    }
    const speed = this.between(...this.rules.moveSpeed) * (isDecoy ? 0.72 : 1);
    if (allowOrbit && !isDecoy && (this.hard || this.insane) && this.random() < 0.35) {
      const orbitR = this.between(22, 34);
      const cx = clamp(pt.x, PAD_X + orbitR, WIDTH - PAD_X - orbitR);
      const cy = clamp(pt.y, PAD_Y + orbitR, HEIGHT - PAD_Y - orbitR);
      const orbitA0 = this.between(0, Math.PI * 2);
      const orbitOmega = this.direction * (speed / orbitR);
      return {
        moveKind: "orbit",
        x0: cx + Math.cos(orbitA0) * orbitR,
        y0: cy + Math.sin(orbitA0) * orbitR,
        vx: 0, vy: 0, cx, cy, orbitR, orbitA0, orbitOmega
      };
    }
    const angle = this.between(0, Math.PI * 2);
    return {
      moveKind: "drift",
      x0: clamp(pt.x, PAD_X, WIDTH - PAD_X),
      y0: clamp(pt.y, PAD_Y, HEIGHT - PAD_Y),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      cx: pt.x, cy: pt.y, orbitR: 0, orbitA0: 0, orbitOmega: 0
    };
  }

  buildTargets() {
    const {count, radius, lifetime, decoyCount, burstChance, doubleChance, shrinkChance} = this.rules;
    const firstSpawn = 0.35;
    const lastSpawn = Math.max(firstSpawn + 0.6, this.duration - lifetime - 0.34);
    const step = count > 1 ? (lastSpawn - firstSpawn) / (count - 1) : 0;
    const minDist = radius * 2.8;

    let id = 0;
    let burstSeq = 0;
    while (id < count) {
      const remaining = count - id;
      const canBurst = remaining >= 2 && this.random() < burstChance;
      if (canBurst) {
        const burstLen = remaining >= 3 && (this.hard || this.insane) && this.random() < 0.55 ? 3 : 2;
        const burstId = ++burstSeq;
        const baseSpawn = firstSpawn + id * step;
        const stagger = this.between(0.24, 0.32);
        const burstSpan = (burstLen - 1) * stagger;
        const startTime = clamp(baseSpawn, 0.32, Math.max(0.32, lastSpawn - burstSpan - 0.08));

        let pt = this.pickFreePoint(startTime, startTime + lifetime + burstSpan, minDist);
        let dir = Math.atan2(HEIGHT / 2 - pt.y, WIDTH / 2 - pt.x) + this.between(-0.55, 0.55);

        for (let b = 0; b < burstLen; b++) {
          const spawn = clamp(startTime + b * stagger, 0.30, this.duration - lifetime - 0.16);
          const end = spawn + lifetime;
          const shrink = this.random() < shrinkChance * 0.5;
          const motion = this.makeMotion(pt, false, false);
          this.targets.push({
            id: id++, spawn, end, decoy: false, struck: false, resolved: false,
            hp: 1, maxHp: 1, shrink, burstId, burstIndex: b + 1, ...motion
          });
          if (b < burstLen - 1) {
            dir += this.between(-0.42, 0.42);
            const hop = this.between(68, 108);
            let nx = pt.x + Math.cos(dir) * hop;
            let ny = pt.y + Math.sin(dir) * hop;
            if (nx < PAD_X + 12 || nx > WIDTH - PAD_X - 12) {
              dir = Math.PI - dir;
              nx = clamp(pt.x + Math.cos(dir) * hop, PAD_X + 12, WIDTH - PAD_X - 12);
            }
            if (ny < PAD_Y + 12 || ny > HEIGHT - PAD_Y - 12) {
              dir = -dir;
              ny = clamp(pt.y + Math.sin(dir) * hop, PAD_Y + 12, HEIGHT - PAD_Y - 12);
            }
            pt = {x: nx, y: ny};
          }
        }
        continue;
      }

      const baseSpawn = firstSpawn + id * step;
      const jitter = id === 0 || id === count - 1 ? 0 : this.between(-0.07, 0.07);
      const armored = this.random() < doubleChance;
      const armorBonus = armored ? 0.22 : 0;
      const sealLifetime = lifetime + armorBonus;
      const maxSoloSpawn = Math.max(0.30, this.duration - sealLifetime - 0.16);
      const spawn = clamp(baseSpawn + jitter, 0.30, maxSoloSpawn);
      const end = spawn + sealLifetime;
      const pt = this.pickFreePoint(spawn, end, minDist);
      const shrink = !armored && this.random() < shrinkChance;
      const motion = this.makeMotion(pt, false, true);
      this.targets.push({
        id: id++, spawn, end, decoy: false, struck: false, resolved: false,
        hp: armored ? 2 : 1, maxHp: armored ? 2 : 1, shrink, burstId: 0, burstIndex: 0, ...motion
      });
    }

    for (let d = 0; d < decoyCount; d++) {
      const host = this.targets[Math.min(count - 1, Math.floor((d + 0.5) * count / decoyCount))];
      const decoyLife = lifetime * 1.05;
      const spawn = clamp(host.spawn - 0.06, 0.32, Math.max(0.32, this.duration - decoyLife - 0.18));
      const end = spawn + decoyLife;
      const pt = this.pickFreePoint(spawn, end, minDist);
      const motion = this.makeMotion(pt, true, false);
      this.targets.push({
        id: count + d, spawn, end, decoy: true, struck: false, resolved: false,
        hp: 1, maxHp: 1, shrink: false, burstId: 0, burstIndex: 0, ...motion
      });
    }
  }

  movePointer(point) {
    if (this.result) return;
    this.state.x = point.x;
    this.state.y = point.y;
    this.state.moving = true;
  }

  findHitTarget(point, time, isDecoy, pad) {
    let best = null;
    let bestDist = Infinity;
    for (const t of this.targets) {
      if (Boolean(t.decoy) !== isDecoy || t.struck || t.resolved || time < t.spawn || time >= t.end) continue;
      const pos = this.posAt(t, time);
      const rad = this.radiusAt(t, time);
      const d = Math.hypot(point.x - pos.x, point.y - pos.y);
      if (d <= rad + pad && d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  clickPointer(point, time) {
    if (this.result) return;
    this.state.x = point.x;
    this.state.y = point.y;

    // Prioritize valid golden seals before decoys so overlapping rings feel fair
    const seal = this.findHitTarget(point, time, false, 6);
    if (seal) {
      this.applyTargetHit(seal, seal.hp - 1, time);
      if (seal.struck) this.state.progress++;
      this.onEvent("timingHit");
      if (this.state.progress >= this.rules.required) {
        this.finish(true, "aim", time);
      }
      return;
    }

    const decoy = this.findHitTarget(point, time, true, 4);
    if (!decoy) return;
    this.applyTargetHit(decoy, 0, time);
    this.onEvent("aimStrike");
    this.damage(time, 0.30);
  }

  applyTargetHit(target, hp, time) {
    const bit = 1 << target.id;
    target.hp = hp;
    if (hp === 0) {
      target.struck = target.resolved = true;
      this.state.aimStruck |= bit;
      this.state.aimCracked &= ~bit;
    } else {
      this.state.aimCracked |= bit;
    }
    const pos = this.posAt(target, clamp(time, target.spawn, target.end));
    const color = target.decoy ? PALETTE.crimson : hp === 0 ? PALETTE.gold : PALETTE.cyan;
    const kind = target.decoy ? "decoy" : hp === 0 ? "hit" : "crack";
    this.pops.push({...pos, time, color, kind});
  }

  syncSpectatorTargets({aimStruck, aimCracked}, time) {
    if (aimStruck === this.state.aimStruck && aimCracked === this.state.aimCracked) return;
    for (const target of this.targets) {
      const bit = 1 << target.id;
      const hp = (aimStruck & bit) ? 0 : (aimCracked & bit) ? 1 : target.maxHp;
      if (hp < target.hp) this.applyTargetHit(target, hp, time);
    }
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
    // 1. Subtle burst guide connectors between consecutive active stream seals
    const byBurst = new Map();
    for (const t of this.targets) {
      if (!t.burstId || t.struck || time < t.spawn || time >= t.end) continue;
      let list = byBurst.get(t.burstId);
      if (!list) byBurst.set(t.burstId, list = []);
      list.push(t);
    }
    if (byBurst.size) {
      ctx.save();
      ctx.strokeStyle = "#fcd57c66";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      for (const group of byBurst.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => a.burstIndex - b.burstIndex);
        ctx.beginPath();
        group.forEach((item, idx) => {
          const pos = this.posAt(item, time);
          if (idx === 0) ctx.moveTo(pos.x, pos.y);
          else ctx.lineTo(pos.x, pos.y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 2. Seals & decoys (layered glow without blur or per-frame gradients)
    for (const t of this.targets) {
      if (t.struck || time < t.spawn || time >= t.end) continue;
      const pos = this.posAt(t, time);
      const r = this.radiusAt(t, time);
      const frac = clamp((time - t.spawn) / (t.end - t.spawn), 0, 1);

      ctx.save();
      if (t.decoy) {
        if (t.moveKind === "drift") {
          const prev = this.posAt(t, Math.max(t.spawn, time - 0.09));
          ctx.strokeStyle = "#fb718555";
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        }
        ctx.strokeStyle = PALETTE.crimson;
        ctx.fillStyle = "#9f123966";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "#fda4af";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(pos.x - 6, pos.y - 6); ctx.lineTo(pos.x + 6, pos.y + 6);
        ctx.moveTo(pos.x + 6, pos.y - 6); ctx.lineTo(pos.x - 6, pos.y + 6);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (t.moveKind === "orbit") {
        ctx.strokeStyle = "#c084fc38";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(t.cx, t.cy, t.orbitR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (t.moveKind === "drift") {
        const prev = this.posAt(t, Math.max(t.spawn, time - 0.08));
        ctx.strokeStyle = "#fcd57c48";
        ctx.lineWidth = r * 0.45;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }

      const armored = t.hp > 1;
      const mainColor = armored ? PALETTE.cyan : t.shrink ? PALETTE.pink : PALETTE.gold;
      const outerR = r * (2.15 - 1.15 * frac);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.45 + 0.55 * frac;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, outerR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
      drawGlow(ctx, pos.x, pos.y, r * 1.65, mainColor, 0.40);
      ctx.fillStyle = armored ? "#13304acc" : "#3b1d5fcc";
      ctx.strokeStyle = armored ? "#a5f3fc" : t.shrink ? "#f5d0fe" : "#fde68a";
      ctx.lineWidth = armored ? 2.6 : 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (armored) {
        ctx.strokeStyle = "#67e8f988";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      crystal(ctx, pos.x, pos.y, r * 0.36, r * 0.48, mainColor);

      if (armored || t.burstIndex) {
        ctx.fillStyle = "#fff8dc";
        ctx.font = "800 10px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(armored ? "×2" : String(t.burstIndex), pos.x, pos.y - r - 8);
      }
      ctx.restore();
    }

    // 3. Expanding click ripples
    for (const pop of this.pops) {
      const age = time - pop.time;
      if (age < 0 || age > 0.32) continue;
      const alpha = 1 - age / 0.32;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = pop.color;
      ctx.lineWidth = pop.kind === "hit" ? 2.5 : 2;
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, 12 + age * 68, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Aiming reticle
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
