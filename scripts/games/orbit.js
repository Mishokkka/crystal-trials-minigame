import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, crystal, drawSoul} from "./base.js";

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const ORBIT_R = 66;
const INWARD_START = 238;
const INWARD_END = 22;
const OUTWARD_START = 18;
const OUTWARD_END = 238;

const LEVELS = {
  easy: {angSpeed: 3.9, speed: 135, interval: 1.12, gapWidth: 1.56, spin: 0.25, outwardChance: 0},
  medium: {angSpeed: 4.4, speed: 168, interval: 0.86, gapWidth: 1.32, spin: 0.50, outwardChance: 0.12},
  hard: {angSpeed: 5.0, speed: 205, interval: 0.66, gapWidth: 1.14, spin: 0.80, outwardChance: 0.25},
  insane: {angSpeed: 5.6, speed: 245, interval: 0.52, gapWidth: 0.98, spin: 1.15, outwardChance: 0.35}
};

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export class OrbitGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.angle = -Math.PI / 2;
    this.state.x = CX + Math.cos(this.angle) * ORBIT_R;
    this.state.y = CY + Math.sin(this.angle) * ORBIT_R;
    this.rings = [];
    this.buildRings();
    this.cues.sort((a, b) => a.time - b.time);
  }

  buildRings() {
    const {angSpeed, speed, interval, gapWidth, spin: maxSpin, outwardChance} = this.cfg;
    let crossTime = 1.40;
    let prevGapAtCross = -Math.PI / 2 + this.direction * 0.9;
    let prevCrossTime = 0;

    while (crossTime < this.duration - 0.18) {
      const outward = this.random() < outwardChance;
      const rStart = outward ? OUTWARD_START : INWARD_START;
      const rEnd = outward ? OUTWARD_END : INWARD_END;
      const rSpeed = speed * this.between(0.94, 1.06);
      const crossDist = Math.abs(ORBIT_R - rStart);
      const spawn = crossTime - crossDist / rSpeed;
      if (spawn < 0.08) {
        crossTime += interval * 0.5;
        continue;
      }
      const end = spawn + Math.abs(rEnd - rStart) / rSpeed;

      const dtCross = prevCrossTime ? crossTime - prevCrossTime : 1.0;
      const maxShift = Math.min(Math.PI, angSpeed * dtCross * 0.58);
      const shift = this.between(-maxShift, maxShift);
      const gapAtCross = prevGapAtCross + shift;
      const spin = this.direction * this.between(0, maxSpin);
      const gapAngle0 = gapAtCross - spin * (crossTime - spawn);

      this.rings.push({
        cue: outward ? Math.max(0.05, spawn - 0.36) : spawn,
        spawn,
        end,
        crossTime,
        outward,
        rStart,
        rEnd,
        speed: rSpeed,
        gapAngle0,
        gapWidth,
        spin
      });
      if (outward) this.cues.push({time: Math.max(0.05, spawn - 0.36), sound: "ShardWave"});

      prevGapAtCross = gapAtCross;
      prevCrossTime = crossTime;
      crossTime += interval * this.between(0.92, 1.08);
    }
  }

  ringRadius(ring, time) {
    const elapsed = time - ring.spawn;
    return ring.outward ? ring.rStart + ring.speed * elapsed : ring.rStart - ring.speed * elapsed;
  }

  update(dt, time, input) {
    this.angle += input.x * this.cfg.angSpeed * dt;
    this.state.x = CX + Math.cos(this.angle) * ORBIT_R;
    this.state.y = CY + Math.sin(this.angle) * ORBIT_R;
    this.state.moving = Math.abs(input.x) > 0;

    for (const ring of this.rings) {
      if (time < ring.spawn || time >= ring.end) continue;
      const r = this.ringRadius(ring, time);
      if (Math.abs(r - ORBIT_R) >= 5.5 + SOUL_RADIUS * 0.65) continue;
      const gap = ring.gapAngle0 + ring.spin * (time - ring.spawn);
      if (angleDiff(this.angle, gap) > ring.gapWidth / 2 - 0.08) {
        this.damage(time);
      }
    }
  }

  draw(ctx, time, state) {
    ctx.save();
    // Orbit track & center core
    ctx.strokeStyle = "#d8b4fe33";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(CX, CY, ORBIT_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const corePulse = 10 + Math.sin(time * 8) * 2;
    crystal(ctx, CX, CY, corePulse, corePulse + 4, this.insane ? PALETTE.insane : PALETTE.violet, time * 0.9);

    for (const ring of this.rings) {
      if (time < ring.cue || time >= ring.end) continue;
      if (ring.outward && time < ring.spawn) {
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.45 + 0.5 * Math.sin(time * 22) ** 2;
        ctx.beginPath();
        ctx.arc(CX, CY, OUTWARD_START + 4, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      const r = this.ringRadius(ring, time);
      if (r <= 4) continue;
      const gap = ring.gapAngle0 + ring.spin * (time - ring.spawn);
      const startA = gap + ring.gapWidth / 2;
      const endA = gap - ring.gapWidth / 2 + Math.PI * 2;
      const color = ring.outward ? PALETTE.gold : (this.insane ? PALETTE.insane : PALETTE.pink);

      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(CX, CY, r, startA, endA);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#fff5ff99";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, r, startA, endA);
      ctx.stroke();
    }
    ctx.restore();

    drawSoul(ctx, state, time);
  }
}
