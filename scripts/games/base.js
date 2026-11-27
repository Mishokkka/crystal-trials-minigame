export const WIDTH = 480;
export const HEIGHT = 360;
export const SOUL_RADIUS = 7;
export const PALETTE = {
  violet: "#a855f7",
  lilac: "#c084fc",
  pink: "#e879f9",
  blue: "#38bdf8",
  amber: "#f59e0b",
  gold: "#fcd57c",
  mint: "#8ff3cb",
  crimson: "#fb7185",
  insane: "#ff4d6d",
  cyan: "#67e8f9"
};

export function mulberry32(seed) {
  return () => {
    let value = seed = (seed + 0x6D2B79F5) >>> 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function crystal(ctx, x, y, rx, ry, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(rx, 0);
  ctx.lineTo(0, ry);
  ctx.lineTo(-rx, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.lineTo(0, ry);
  ctx.lineTo(-rx, 0);
  ctx.closePath();
  ctx.fillStyle = "#ffffff55";
  ctx.fill();
  ctx.restore();
}

export function drawSoul(ctx, state, time, color = "#f2ceff") {
  if (time < state.invulnerableUntil && Math.floor(time * 18) % 2) return;
  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = PALETTE.pink;
  crystal(ctx, state.x, state.y, 9, 11, color);
  ctx.shadowBlur = 0;
  crystal(ctx, state.x, state.y, 3, 4, "#fff9ff");
  ctx.restore();
}

export function arenaBackground(ctx) {
  ctx.fillStyle = "#0b0912";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 0, WIDTH / 2, HEIGHT / 2, WIDTH / 2);
  glow.addColorStop(0, "#211230");
  glow.addColorStop(1, "#0b0912");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "#d8a7ff0d";
  ctx.beginPath();
  for (let x = 20; x < WIDTH; x += 20) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, HEIGHT);
  }
  for (let y = 20; y < HEIGHT; y += 20) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WIDTH, y + 0.5);
  }
  ctx.stroke();
}

export class ArenaGame {
  constructor(session, onEvent) {
    this.difficulty = session.difficulty;
    this.hard = session.difficulty === "hard";
    this.insane = session.difficulty === "insane";
    this.duration = session.durationSec;
    this.random = mulberry32(session.seed);
    this.onEvent = onEvent;
    this.hitsTaken = 0;
    this.maxLives = session.lives;
    this.result = null;
    this.cues = [];
    this.currentTime = 0;
    this.lastMoveTime = -1;
    this.state = {
      x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, moving: false,
      lives: session.lives, progress: 0, activeStarted: true, invulnerableUntil: 0
    };
  }

  get direction() {
    return this.random() < 0.5 ? -1 : 1;
  }

  between(min, max) {
    return min + this.random() * (max - min);
  }

  moveFree(dt, input, speed = 212, time = this.currentTime) {
    const {x, y} = input;
    const length = Math.hypot(x, y) || 1;
    const state = this.state;
    const nextX = clamp(state.x + (x / length) * speed * dt, 13, WIDTH - 13);
    const nextY = clamp(state.y + (y / length) * speed * dt, 13, HEIGHT - 13);
    state.vx = (nextX - state.x) / dt;
    state.vy = (nextY - state.y) / dt;
    state.moving = Math.hypot(state.vx, state.vy) > 12;
    if (state.moving && Number.isFinite(time)) this.lastMoveTime = time;
    state.x = nextX;
    state.y = nextY;
  }

  damage(time, cooldown = 0.75) {
    if (this.result || time < this.state.invulnerableUntil) return false;
    this.hitsTaken++;
    this.state.lives--;
    this.state.invulnerableUntil = time + cooldown;
    this.onEvent("hit");
    if (this.state.lives === 0) this.finish(false, "lives", time);
    return true;
  }

  finish(success, reason, time) {
    if (this.result) return;
    this.result = {
      success, reason, hitsTaken: this.hitsTaken, livesLeft: this.state.lives,
      maxLives: this.maxLives, elapsedSec: clamp(time, 0, this.duration)
    };
    this.onEvent("finish");
  }

  step(dt, time, input) {
    if (this.result) return;
    this.currentTime = time;
    this.update(dt, time, input);
    if (time >= this.duration) this.finish(true, "survived", time);
  }

  start() {}
  press() {}
  movePointer() {}
  leavePointer() {}
}
