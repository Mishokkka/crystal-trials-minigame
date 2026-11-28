import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, crystal, drawSoul} from "./base.js";

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const ORBIT_R = 66;
const INWARD_START = 248;
const INWARD_END = 22;

const LEVELS = {
  easy: {angSpeed: 4.1, speed: 145, interval: 0.94, gapWidth: 1.48, spin: 0.28, patternChance: 0.20, doubleGapChance: 0},
  medium: {angSpeed: 4.7, speed: 182, interval: 0.68, gapWidth: 1.24, spin: 0.56, patternChance: 0.42, doubleGapChance: 0},
  hard: {angSpeed: 5.4, speed: 224, interval: 0.48, gapWidth: 1.06, spin: 0.90, patternChance: 0.62, doubleGapChance: 0.20},
  insane: {angSpeed: 6.2, speed: 268, interval: 0.36, gapWidth: 0.90, spin: 1.28, patternChance: 0.78, doubleGapChance: 0.32}
};

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function drawRingSegments(ctx, r, gap, gw, gaps) {
  ctx.beginPath();
  if (gaps === 2) {
    ctx.arc(CX, CY, r, gap + gw / 2, gap + Math.PI - gw / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, CY, r, gap + Math.PI + gw / 2, gap + Math.PI * 2 - gw / 2);
    ctx.stroke();
  } else {
    ctx.arc(CX, CY, r, gap + gw / 2, gap - gw / 2 + Math.PI * 2);
    ctx.stroke();
  }
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
    const {angSpeed, speed, interval, gapWidth, spin: maxSpin, patternChance, doubleGapChance} = this.cfg;
    const crossDist = INWARD_START - ORBIT_R;
    const totalDist = INWARD_START - INWARD_END;
    const minStartCross = 0.08 + crossDist / speed + 0.06;

    let crossTime = Math.max(1.22, minStartCross);
    let prevGapAtCross = -Math.PI / 2 + this.direction * 0.7;
    let prevCrossTime = 0;
    let prevGaps = 1;

    let patternLeft = 0;
    let patternKind = "spiral";
    let patternDir = this.direction;
    let lastCueTime = -1;

    while (crossTime < this.duration - 0.16) {
      const rSpeed = patternLeft > 0 ? speed : speed * this.between(0.95, 1.05);
      const gaps = prevCrossTime && this.random() < doubleGapChance ? 2 : 1;
      // Exiting a symmetric 2-gap ring into a 1-gap ring must stay reachable from BOTH openings (±π/2)
      if (prevGaps === 2 && gaps === 1 && prevCrossTime) {
        const minTransition = (Math.PI / 2) / (angSpeed * 0.62);
        if (crossTime - prevCrossTime < minTransition) {
          crossTime = prevCrossTime + minTransition;
          if (crossTime >= this.duration - 0.16) break;
        }
      }

      const spawn = crossTime - crossDist / rSpeed;
      if (spawn < 0.06) {
        crossTime += interval * 0.45;
        continue;
      }

      if (patternLeft === 0 && this.random() < patternChance) {
        patternLeft = this.insane ? 5 : this.hard ? 4 : 3;
        patternKind = this.random() < 0.55 ? "spiral" : "zigzag";
        patternDir = this.direction;
        if (spawn - lastCueTime >= 1.8) {
          this.cues.push({time: Math.max(0.05, spawn), sound: "ShardWave"});
          lastCueTime = spawn;
        }
      }

      const end = spawn + totalDist / rSpeed;
      const dtCross = prevCrossTime ? crossTime - prevCrossTime : 1.0;
      const maxShift = Math.min(Math.PI, angSpeed * dtCross * 0.58);

      let shift;
      if (prevGaps === 2 && gaps === 1) {
        shift = (patternLeft > 0 ? patternDir : this.direction) * (Math.PI / 2);
        if (patternLeft > 0) {
          if (patternKind === "zigzag") patternDir *= -1;
          patternLeft--;
        }
      } else if (patternLeft > 0) {
        if (patternKind === "spiral") {
          shift = patternDir * Math.min(maxShift, angSpeed * dtCross * this.between(0.38, 0.50));
        } else {
          patternDir *= -1;
          shift = patternDir * Math.min(maxShift, angSpeed * dtCross * this.between(0.42, 0.54));
        }
        patternLeft--;
      } else {
        shift = this.between(-maxShift, maxShift);
      }

      const gapAtCross = prevGapAtCross + shift;
      const spin = patternKind === "spiral" && patternLeft > 0
        ? patternDir * this.between(0, maxSpin * 0.75)
        : this.direction * this.between(0, maxSpin);
      const gapAngle0 = gapAtCross - spin * (crossTime - spawn);
      const ringGapW = gaps === 2 ? gapWidth * 0.86 : gapWidth;

      this.rings.push({
        spawn,
        end,
        crossTime,
        speed: rSpeed,
        gapAngle0,
        gapWidth: ringGapW,
        gaps,
        spin
      });

      prevGapAtCross = gapAtCross;
      prevCrossTime = crossTime;
      prevGaps = gaps;
      const stepScale = patternLeft > 0
        ? ((this.hard || this.insane) ? 0.86 : 0.94)
        : this.between(0.92, 1.08);
      crossTime += interval * stepScale;
    }
  }

  ringRadius(ring, time) {
    return INWARD_START - ring.speed * (time - ring.spawn);
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
      const dist = ring.gaps === 2
        ? Math.min(angleDiff(this.angle, gap), angleDiff(this.angle, gap + Math.PI))
        : angleDiff(this.angle, gap);
      if (dist > ring.gapWidth / 2 - 0.08) {
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

    let nearestRing = null;
    let nearestR = Infinity;
    for (const ring of this.rings) {
      if (time < ring.spawn || time >= ring.end) continue;
      const r = this.ringRadius(ring, time);
      if (r >= ORBIT_R - 8 && r < nearestR) {
        nearestR = r;
        nearestRing = ring;
      }
    }

    for (const ring of this.rings) {
      if (time < ring.spawn || time >= ring.end) continue;
      const r = this.ringRadius(ring, time);
      if (r <= 4) continue;
      const gap = ring.gapAngle0 + ring.spin * (time - ring.spawn);
      const isNext = ring === nearestRing;
      const color = isNext ? (this.insane ? PALETTE.insane : PALETTE.pink) : PALETTE.violet;

      ctx.lineCap = "round";
      if (isNext) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 14;
        drawRingSegments(ctx, r, gap, ring.gapWidth, ring.gaps);

        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 8;
        drawRingSegments(ctx, r, gap, ring.gapWidth, ring.gaps);

        ctx.strokeStyle = "#fff5ffbb";
        ctx.lineWidth = 2;
        drawRingSegments(ctx, r, gap, ring.gapWidth, ring.gaps);

        // Bright golden lip markers framing the safe opening(s)
        ctx.fillStyle = PALETTE.gold;
        ctx.globalAlpha = 0.92;
        const openings = ring.gaps === 2 ? [gap, gap + Math.PI] : [gap];
        for (const baseG of openings) {
          for (const side of [-1, 1]) {
            const lipA = baseG + side * (ring.gapWidth / 2);
            ctx.beginPath();
            ctx.arc(CX + Math.cos(lipA) * r, CY + Math.sin(lipA) * r, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        const depthAlpha = r < ORBIT_R - 8 ? 0.30 : 0.62;
        ctx.strokeStyle = color;
        ctx.globalAlpha = depthAlpha;
        ctx.lineWidth = 6;
        drawRingSegments(ctx, r, gap, ring.gapWidth, ring.gaps);

        ctx.strokeStyle = "#e9d5ff66";
        ctx.globalAlpha = depthAlpha * 0.9;
        ctx.lineWidth = 1.6;
        drawRingSegments(ctx, r, gap, ring.gapWidth, ring.gaps);
      }
    }
    ctx.restore();

    drawSoul(ctx, state, time);
  }
}
