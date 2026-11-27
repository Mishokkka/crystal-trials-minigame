import {ArenaGame, HEIGHT, PALETTE, WIDTH, clamp, crystal, drawSoul} from "./base.js";

export const SHIELD_MAX_PROGRESS = 80;

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const HIT_DIST = 24;
const START_DIST = 232;

const DIRS = [
  {dx: 0, dy: -1, angle: -Math.PI / 2},
  {dx: 1, dy: 0, angle: 0},
  {dx: 0, dy: 1, angle: Math.PI / 2},
  {dx: -1, dy: 0, angle: Math.PI}
];

const LEVELS = {
  easy: {interval: [0.64, 0.80], speed: [175, 205], flipChance: 0},
  medium: {interval: [0.46, 0.60], speed: [220, 260], flipChance: 0.14},
  hard: {interval: [0.34, 0.46], speed: [265, 320], flipChance: 0.30},
  insane: {interval: [0.25, 0.36], speed: [315, 385], flipChance: 0.44}
};

function facingFromState(state) {
  const vx = state.vx ?? 0;
  const vy = state.vy ?? -1;
  if (Math.abs(vy) >= Math.abs(vx)) return vy <= 0 ? 0 : 2;
  return vx >= 0 ? 1 : 3;
}

export class ShieldGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.facing = 0;
    this.state.x = CX;
    this.state.y = CY;
    this.state.vx = 0;
    this.state.vy = -1;
    this.lastBlockAt = -1;
    this.spears = [];
    this.buildSpears();
    this.cues.sort((a, b) => a.time - b.time);
  }

  setFacing(dir) {
    if (dir < 0 || dir > 3) return;
    this.facing = dir;
    this.state.vx = DIRS[dir].dx;
    this.state.vy = DIRS[dir].dy;
  }

  buildSpears() {
    let impact = 0.96;
    let prevDir = null;
    let prevImpact = 0;

    while (impact < this.duration - 0.16) {
      const startDir = Math.floor(this.random() * 4);
      const flip = this.random() < this.cfg.flipChance;
      const finalDir = flip ? (startDir + 2) % 4 : startDir;
      if (prevDir !== null && finalDir !== prevDir) {
        const minTurnGap = this.insane ? 0.22 : this.hard ? 0.28 : 0.34;
        impact = Math.max(impact, prevImpact + minTurnGap);
      }
      if (impact >= this.duration - 0.16) break;

      const speed = this.between(...this.cfg.speed);
      const spawn = Math.max(0.05, impact - (START_DIST - HIT_DIST) / speed);
      this.spears.push({
        spawn,
        impact,
        speed,
        startDir,
        finalDir,
        flip,
        flipSide: this.direction,
        resolved: false
      });
      if (flip) this.cues.push({time: Math.max(0.05, spawn + 0.05), sound: "Telegraph"});
      prevDir = finalDir;
      prevImpact = impact;
      impact += this.between(...this.cfg.interval);
    }
  }

  press(action) {
    if (this.result || !action.startsWith("dir")) return;
    const dir = Number(action.slice(3));
    if (Number.isInteger(dir) && dir >= 0 && dir <= 3) this.setFacing(dir);
  }

  update(dt, time, input) {
    if (input.y < 0) this.setFacing(0);
    else if (input.x > 0) this.setFacing(1);
    else if (input.y > 0) this.setFacing(2);
    else if (input.x < 0) this.setFacing(3);
    this.state.moving = true;

    for (const spear of this.spears) {
      if (spear.resolved || time < spear.impact) continue;
      spear.resolved = true;
      if (this.facing === spear.finalDir) {
        this.state.progress = Math.min(SHIELD_MAX_PROGRESS, this.state.progress + 1);
        this.lastBlockAt = time;
        this.onEvent("block");
      } else {
        this.damage(time, 0.30);
      }
    }
  }

  spearPose(spear, time) {
    const dist = HIT_DIST + (spear.impact - time) * spear.speed;
    const baseAngle = DIRS[spear.startDir].angle;
    if (!spear.flip || dist > 128) {
      return {r: dist, angle: baseAngle};
    }
    if (dist >= 64) {
      const u = clamp((128 - dist) / 64, 0, 1);
      return {r: 128 - 64 * u, angle: baseAngle + Math.PI * u * spear.flipSide};
    }
    return {r: dist, angle: baseAngle + Math.PI * spear.flipSide};
  }

  draw(ctx, time, state) {
    const facing = facingFromState(state);
    const shieldAngle = DIRS[facing].angle;

    // Subtle 4-way target crosshairs
    ctx.save();
    ctx.strokeStyle = "#d8b4fe1f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CX, 24); ctx.lineTo(CX, HEIGHT - 24);
    ctx.moveTo(40, CY); ctx.lineTo(WIDTH - 40, CY);
    ctx.arc(CX, CY, 34, 0, Math.PI * 2);
    ctx.stroke();

    // Active energy shield arc
    ctx.strokeStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(CX, CY, 30, shieldAngle - 0.72, shieldAngle + 0.72);
    ctx.stroke();

    ctx.strokeStyle = "#ffffffcc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CX, CY, 30, shieldAngle - 0.56, shieldAngle + 0.56);
    ctx.stroke();
    ctx.restore();

    // Incoming spears (render purely by time so spectators match active view cleanly)
    let nearestTime = Infinity;
    let nearestSpear = null;
    for (const spear of this.spears) {
      if (time >= spear.spawn && time < spear.impact && spear.impact < nearestTime) {
        nearestTime = spear.impact;
        nearestSpear = spear;
      }
    }

    for (const spear of this.spears) {
      if (time < spear.spawn || time >= spear.impact) continue;
      const {r, angle} = this.spearPose(spear, time);
      const sx = CX + Math.cos(angle) * r;
      const sy = CY + Math.sin(angle) * r;
      const isNext = spear === nearestSpear;
      const color = spear.flip ? PALETTE.gold : (isNext ? PALETTE.cyan : PALETTE.lilac);

      if (spear.flip && r > 64) {
        ctx.save();
        ctx.strokeStyle = "#fcd57c44";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const startA = DIRS[spear.startDir].angle;
        ctx.arc(CX, CY, 92, startA, startA + Math.PI * spear.flipSide, spear.flipSide < 0);
        ctx.stroke();
        ctx.restore();
      }

      // Spear tip oriented inward toward center
      const inwardAngle = angle + Math.PI;
      crystal(ctx, sx, sy, isNext ? 7 : 5.5, isNext ? 14 : 11, color, inwardAngle + Math.PI / 2);
    }

    drawSoul(ctx, {...state, x: CX, y: CY}, time, PALETTE.mint);
  }
}
