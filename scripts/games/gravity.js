import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, drawSoul} from "./base.js";

const FLOOR = 315;
const GROUND = FLOOR - 10;
const LEVELS = {
  easy: {
    moveSpeed: 205, warning: 0.56, speed: [185, 205], interval: [1.55, 1.75],
    heights: [22, 38], maxChain: 2, aerialChance: 0, pairedChance: 0
  },
  medium: {
    moveSpeed: 222, warning: 0.48, speed: [225, 265], interval: [1.18, 1.42],
    heights: [26, 50], maxChain: 3, aerialChance: 0.22, pairedChance: 0.18
  },
  hard: {
    moveSpeed: 244, warning: 0.42, speed: [300, 385], interval: [0.88, 1.08],
    heights: [30, 64], maxChain: 3, aerialChance: 0.30, pairedChance: 0.35
  },
  insane: {
    moveSpeed: 266, warning: 0.38, speed: [350, 445], interval: [0.72, 0.90],
    heights: [34, 68], maxChain: 4, aerialChance: 0.34, pairedChance: 0.45
  }
};

export class GravityGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.state.y = GROUND;
    this.jumpAt = -1;
    this.jumpUntil = -1;
    this.rows = [];
    this.buildGauntlet();
  }

  buildGauntlet() {
    const {warning, speed: speedRange, interval, heights, maxChain, aerialChance, pairedChance} = this.cfg;
    const minImpact = warning + 0.08 + WIDTH / 2 / speedRange[0];
    let impact = Math.max(1.20, minImpact);
    let prevDirection = this.direction;

    while (impact < this.duration - 0.38) {
      const direction = this.random() < 0.72 ? -prevDirection : prevDirection;
      prevDirection = direction;
      const isAerial = this.random() < aerialChance;
      const paired = !isAerial && this.random() < pairedChance;
      const directions = paired ? [direction, -direction] : [direction];

      for (const side of directions) {
        const speed = this.between(...speedRange);
        const stagger = side === direction ? 0 : this.between(-0.03, 0.035);
        const minStart = warning + 0.05;
        const start = Math.max(minStart, impact - WIDTH / 2 / speed + stagger);
        if (start >= this.duration - 0.85) continue;

        if (isAerial) {
          this.rows.push({
            kind: "aerial",
            start,
            direction: side,
            speed,
            width: this.between(46, 70),
            bottom: this.between(45, 54),
            thickness: this.between(18, 22)
          });
        } else {
          const capCount = paired ? Math.min(2, maxChain) : maxChain;
          const count = 1 + Math.floor(this.random() * capCount);
          const maxChainWidth = speed * 0.32 - SOUL_RADIUS * 2;
          const maxEachW = Math.max(16, Math.floor((maxChainWidth - (count - 1) * 3) / count));
          const maxW = Math.min(count < 3 ? 29 : 23, maxEachW);
          const minW = Math.min(17, maxW);
          const sizes = Array.from({length: count}, () => ({
            width: this.between(minW, maxW),
            height: this.between(...heights)
          }));
          this.rows.push({kind: "floor", start, direction: side, speed, sizes});
        }
      }

      const step = this.between(...interval);
      impact += isAerial ? Math.max(0.68, step * 0.85) : Math.max(0.74, step);
    }
  }

  press(action, time) {
    if (action === "jump") this.jumpUntil = time + 0.11;
  }

  forEachSpike(row, time, callback) {
    const travel = (time - row.start) * row.speed;
    let offset = 0;
    for (const size of row.sizes) {
      const edge = travel - offset;
      const x = row.direction === 1 ? edge - size.width : WIDTH - edge;
      if (x > -size.width && x < WIDTH) callback(x, size);
      offset += size.width + 3;
    }
  }

  aerialX(row, time) {
    const travel = (time - row.start) * row.speed;
    return row.direction === 1 ? travel - row.width : WIDTH - travel;
  }

  update(dt, time, input) {
    const state = this.state;
    const nextX = clamp(state.x + input.x * this.cfg.moveSpeed * dt, 14, WIDTH - 14);
    state.vx = (nextX - state.x) / dt;
    state.x = nextX;
    if (state.y >= GROUND && time <= this.jumpUntil) {
      state.vy = -402;
      this.jumpAt = time;
      this.jumpUntil = -1;
      this.onEvent("jump");
    }
    let gravity = 1460;
    if (input.y > 0 && state.y < GROUND) gravity = 2950;
    else if (input.jump && state.vy < 0 && time - this.jumpAt < 0.22) gravity = 810;

    state.vy += gravity * dt;
    state.y += state.vy * dt;
    if (state.y >= GROUND) {
      state.y = GROUND;
      state.vy = 0;
    }
    state.moving = Math.hypot(state.vx, state.vy) > 12;

    for (const row of this.rows) {
      if (time < row.start) continue;
      if (row.kind === "aerial") {
        const x = this.aerialX(row, time);
        if (x <= -row.width || x >= WIDTH) continue;
        const yBottom = FLOOR - row.bottom;
        const yTop = yBottom - row.thickness;
        if (state.y + SOUL_RADIUS - 2 > yTop && state.y - SOUL_RADIUS + 2 < yBottom
          && state.x + SOUL_RADIUS - 2 > x && state.x - SOUL_RADIUS + 2 < x + row.width) {
          this.damage(time);
        }
        continue;
      }
      this.forEachSpike(row, time, (x, {width, height}) => {
        const foot = state.y + SOUL_RADIUS;
        if (foot <= FLOOR - height) return;
        const halfWidth = width * clamp((foot - FLOOR + height) / height, 0, 1) / 2;
        if (Math.abs(state.x - x - width / 2) < halfWidth + SOUL_RADIUS - 2) this.damage(time);
      });
    }
  }

  draw(ctx, time, state) {
    const floorGlow = ctx.createLinearGradient(0, FLOOR, 0, HEIGHT);
    floorGlow.addColorStop(0, "#8a3cd14f");
    floorGlow.addColorStop(1, "#100b1d");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, FLOOR, WIDTH, HEIGHT - FLOOR);
    ctx.fillStyle = PALETTE.lilac;
    ctx.fillRect(0, FLOOR, WIDTH, 2);

    const warning = this.cfg.warning;
    for (const row of this.rows) {
      if (time < row.start - warning) continue;
      if (time < row.start) {
        const progress = 1 - (row.start - time) / warning;
        const length = 6 + 21 * progress;
        const x = row.direction === 1 ? 8 : WIDTH - 8 - length;
        if (row.kind === "aerial") {
          const yBottom = FLOOR - row.bottom;
          ctx.fillStyle = PALETTE.cyan;
          ctx.fillRect(x, yBottom - row.thickness / 2 - 2, length, 4);
        } else {
          ctx.fillStyle = this.insane ? PALETTE.insane : "#f0abfc";
          ctx.fillRect(x, FLOOR - 4, length, 4);
        }
        continue;
      }
      if (row.kind === "aerial") {
        const x = this.aerialX(row, time);
        if (x <= -row.width || x >= WIDTH) continue;
        const yTop = FLOOR - row.bottom - row.thickness;
        ctx.save();
        ctx.fillStyle = "#38bdf844";
        ctx.strokeStyle = PALETTE.cyan;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = PALETTE.cyan;
        ctx.shadowBlur = 10;
        ctx.fillRect(x, yTop, row.width, row.thickness);
        ctx.strokeRect(x, yTop, row.width, row.thickness);
        ctx.fillStyle = "#e0f2feaa";
        ctx.fillRect(x + 3, yTop + row.thickness / 2 - 1, Math.max(2, row.width - 6), 2);
        ctx.restore();
        continue;
      }
      this.forEachSpike(row, time, (x, {width, height}) => {
        ctx.fillStyle = "#ad5de9";
        ctx.beginPath();
        ctx.moveTo(x, FLOOR);
        ctx.lineTo(x + width / 2, FLOOR - height);
        ctx.lineTo(x + width, FLOOR);
        ctx.fill();
        ctx.fillStyle = this.insane ? PALETTE.insane : PALETTE.pink;
        ctx.beginPath();
        ctx.moveTo(x + width / 2, FLOOR - height);
        ctx.lineTo(x + width * 0.68, FLOOR);
        ctx.lineTo(x + width, FLOOR);
        ctx.fill();
      });
    }
    drawSoul(ctx, state, time, "#d185ff");
  }
}
