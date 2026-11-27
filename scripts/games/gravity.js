import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, drawSoul} from "./base.js";

const FLOOR = 315;
const CEILING = 45;
const GROUND = FLOOR - 10;
const CEIL_GROUND = CEILING + 10;
const PLAT_OFFSET = 52;

const LEVELS = {
  easy: {
    moveSpeed: 215, warning: 0.56, speed: [195, 225], interval: [1.35, 1.58],
    heights: [22, 40], maxChain: 2, gateChance: 0, stalChance: 0.25, lavaCount: 0, flipCount: 0
  },
  medium: {
    moveSpeed: 230, warning: 0.48, speed: [235, 280], interval: [1.08, 1.32],
    heights: [26, 52], maxChain: 3, gateChance: 0.28, stalChance: 0.32, lavaCount: 1, flipCount: 0
  },
  hard: {
    moveSpeed: 252, warning: 0.42, speed: [305, 390], interval: [0.85, 1.06],
    heights: [30, 62], maxChain: 3, gateChance: 0.36, stalChance: 0.38, lavaCount: 1, flipCount: 1
  },
  insane: {
    moveSpeed: 272, warning: 0.37, speed: [345, 435], interval: [0.72, 0.90],
    heights: [32, 66], maxChain: 4, gateChance: 0.42, stalChance: 0.42, lavaCount: 2, flipCount: 2
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
    this.flips = [];
    this.buildFlips();
    this.buildGauntlet();
    this.cues.sort((a, b) => a.time - b.time);
  }

  buildFlips() {
    if (!this.cfg.flipCount) return;
    if (this.hard && this.random() >= 0.6) return;
    const f1Start = this.between(3.2, 4.3);
    const f1End = Math.min(this.duration - 2.0, f1Start + this.between(3.3, 3.7));
    this.flips.push({start: f1Start, end: f1End, cueStart: f1Start - 0.65, cueEnd: f1End - 0.55});
    this.cues.push({time: f1Start - 0.65, sound: "Telegraph"}, {time: f1End - 0.55, sound: "Telegraph"});

    if (this.cfg.flipCount >= 2 && f1End + 4.8 < this.duration && this.random() < 0.7) {
      const f2Start = f1End + this.between(1.6, 2.0);
      const f2End = Math.min(this.duration - 1.1, f2Start + this.between(3.2, 3.6));
      this.flips.push({start: f2Start, end: f2End, cueStart: f2Start - 0.65, cueEnd: f2End - 0.55});
      this.cues.push({time: f2Start - 0.65, sound: "Telegraph"}, {time: f2End - 0.55, sound: "Telegraph"});
    }
  }

  surfaceAt(time) {
    const flipped = this.flips.some(f => time >= f.start && time < f.end);
    return flipped
      ? {dir: -1, surfaceY: CEILING, groundY: CEIL_GROUND}
      : {dir: 1, surfaceY: FLOOR, groundY: GROUND};
  }

  nearFlipTransition(time) {
    return this.flips.some(f =>
      Math.abs(time - f.start) < 0.85 || Math.abs(time - f.end) < 0.85
    );
  }

  buildGauntlet() {
    const {warning, speed: speedRange, interval, heights, maxChain, gateChance, stalChance, lavaCount} = this.cfg;
    const minImpact = warning + 0.08 + WIDTH / 2 / speedRange[0];
    let impact = Math.max(1.18, minImpact);
    let prevDirection = this.direction;
    let lavasPlaced = 0;

    while (impact < this.duration - 0.45) {
      const {dir: surfDir} = this.surfaceAt(impact);
      const nearFlip = this.nearFlipTransition(impact);
      const direction = this.random() < 0.7 ? -prevDirection : prevDirection;
      prevDirection = direction;

      // Lava wave with rideable floating platform
      if (lavasPlaced < lavaCount && !nearFlip && impact > 2.2 && impact < this.duration - 2.3 && this.random() < 0.35) {
        const speed = this.between(150, 185);
        const platW = this.between(96, 114);
        const surgeLen = this.between(330, 420);
        const start = Math.max(warning + 0.08, impact - WIDTH / 2 / speed);
        const platStart = Math.max(warning + 0.05, start - 0.55);
        if (start < this.duration - 2.0) {
          this.rows.push({
            kind: "lava",
            start,
            platStart,
            direction,
            speed,
            platW,
            surgeLen,
            surgeH: 30,
            surfDir
          });
          lavasPlaced++;
          impact += surgeLen / speed + 0.95;
          continue;
        }
      }

      // Falling stalactites targeting center + side, guaranteeing >=110px continuous safe corridor
      if (!nearFlip && this.random() < stalChance) {
        const start = Math.max(warning + 0.65, impact - 0.35);
        const dropWarn = Math.max(0.56, warning + 0.20);
        const dropSpeed = this.between(540, 680);
        if (start < this.duration - 0.75) {
          const safeCenter = this.random() < 0.5
            ? this.between(68, 165)
            : this.between(WIDTH - 165, WIDTH - 68);
          const safeHalf = 62;
          const cols = [];
          // Left block if space
          if (safeCenter - safeHalf > 42) {
            cols.push({x: this.between(24, safeCenter - safeHalf - 36), w: this.between(34, 42)});
          }
          // Center block forcing player off center
          if (Math.abs(WIDTH / 2 - safeCenter) > safeHalf + 20) {
            cols.push({x: WIDTH / 2 - 20 + this.between(-18, 18), w: 40});
          }
          // Right block if space
          if (safeCenter + safeHalf < WIDTH - 42) {
            cols.push({x: this.between(safeCenter + safeHalf, WIDTH - 62), w: this.between(34, 42)});
          }
          if (cols.length) {
            this.rows.push({
              kind: "stalactite",
              start,
              cue: start - dropWarn,
              speed: dropSpeed,
              cols,
              surfDir
            });
            this.cues.push({time: Math.max(0.05, start - dropWarn), sound: "Telegraph"});
          }
        }
        impact += this.between(...interval) * 0.9;
        continue;
      }

      const speed = this.between(...speedRange);
      const minStart = warning + 0.05;
      const start = Math.max(minStart, impact - WIDTH / 2 / speed);
      if (start >= this.duration - 0.85) {
        impact += 1;
        continue;
      }

      // Gate: simultaneous low surface spike + upper floating prism requiring controlled jump height
      if (!nearFlip && this.random() < gateChance) {
        const spikeH = this.between(26, 36);
        const gapH = this.between(54, 62);
        this.rows.push({
          kind: "gate",
          start,
          direction,
          speed,
          width: this.between(36, 48),
          spikeH,
          prismBottom: spikeH + gapH,
          prismThick: 18,
          surfDir
        });
      } else {
        const paired = !nearFlip && (this.hard || this.insane) && this.random() < (this.insane ? 0.42 : 0.32);
        const dirs = paired ? [direction, -direction] : [direction];
        for (const side of dirs) {
          const sSpeed = side === direction ? speed : this.between(...speedRange);
          const stagger = side === direction ? 0 : this.between(-0.03, 0.035);
          const rStart = Math.max(minStart, impact - WIDTH / 2 / sSpeed + stagger);
          if (rStart >= this.duration - 0.85) continue;
          const cap = paired ? Math.min(2, maxChain) : maxChain;
          const count = 1 + Math.floor(this.random() * cap);
          const maxChainW = sSpeed * 0.32 - SOUL_RADIUS * 2;
          const maxEachW = Math.max(16, Math.floor((maxChainW - (count - 1) * 3) / count));
          const maxW = Math.min(count < 3 ? 28 : 22, maxEachW);
          const minW = Math.min(17, maxW);
          const sizes = Array.from({length: count}, () => ({
            width: this.between(minW, maxW),
            height: this.between(...heights)
          }));
          this.rows.push({kind: "floor", start: rStart, direction: side, speed: sSpeed, sizes, surfDir});
        }
      }

      impact += Math.max(0.74, this.between(...interval));
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

  spanX(row, time, width, startOverride = row.start) {
    const travel = (time - startOverride) * row.speed;
    return row.direction === 1 ? travel - width : WIDTH - travel;
  }

  update(dt, time, input) {
    const state = this.state;
    const {dir, surfaceY, groundY} = this.surfaceAt(time);
    const nextX = clamp(state.x + input.x * this.cfg.moveSpeed * dt, 14, WIDTH - 14);
    state.vx = (nextX - state.x) / dt;
    state.x = nextX;

    const prevY = state.y;
    const fastFall = dir === 1 ? input.y > 0 : input.y < 0;

    // Check active rideable platforms (from "lava" waves)
    let platSurface = null;
    if (!fastFall) {
      for (const row of this.rows) {
        if (row.kind !== "lava" || time < row.platStart || row.surfDir !== dir) continue;
        const px = this.spanX(row, time, row.platW, row.platStart);
        if (state.x + SOUL_RADIUS - 2 > px && state.x - SOUL_RADIUS + 2 < px + row.platW) {
          const py = surfaceY - dir * PLAT_OFFSET;
          if (dir === 1 && state.vy >= 0 && prevY + SOUL_RADIUS <= py + 6) {
            platSurface = py - SOUL_RADIUS;
          } else if (dir === -1 && state.vy <= 0 && prevY - SOUL_RADIUS >= py - 6) {
            platSurface = py + SOUL_RADIUS;
          }
        }
      }
    }

    const onMainSurface = dir === 1 ? state.y >= groundY - 0.5 : state.y <= groundY + 0.5;
    const onPlatform = platSurface !== null && (dir === 1 ? state.y >= platSurface - 2 : state.y <= platSurface + 2);
    if ((onMainSurface || onPlatform) && time <= this.jumpUntil) {
      state.vy = -402 * dir;
      this.jumpAt = time;
      this.jumpUntil = -1;
      this.onEvent("jump");
    }

    let gravity = 1460;
    const rising = dir === 1 ? state.vy < 0 : state.vy > 0;
    if (fastFall && !onMainSurface) gravity = 2950;
    else if (input.jump && rising && time - this.jumpAt < 0.22) gravity = 810;

    state.vy += gravity * dir * dt;
    state.y += state.vy * dt;

    if (platSurface !== null && !fastFall && ((dir === 1 && state.vy >= 0 && state.y >= platSurface) || (dir === -1 && state.vy <= 0 && state.y <= platSurface))) {
      state.y = platSurface;
      state.vy = 0;
    }
    if (dir === 1 && state.y >= groundY) {
      state.y = groundY;
      state.vy = 0;
    } else if (dir === -1 && state.y <= groundY) {
      state.y = groundY;
      state.vy = 0;
    }
    state.moving = Math.hypot(state.vx, state.vy) > 12;

    for (const row of this.rows) {
      if (row.kind === "stalactite") {
        if (time < row.start) continue;
        const travel = (time - row.start) * row.speed;
        const span = FLOOR - CEILING;
        if (travel > span + 80) continue;
        const tipY = row.surfDir === 1 ? CEILING + travel : FLOOR - travel;
        const tailY = row.surfDir === 1 ? tipY - 58 : tipY + 58;
        const yTop = Math.min(tipY, tailY);
        const yBot = Math.max(tipY, tailY);
        if (state.y + SOUL_RADIUS - 2 > yTop && state.y - SOUL_RADIUS + 2 < yBot) {
          if (row.cols.some(c => state.x + SOUL_RADIUS - 2 > c.x && state.x - SOUL_RADIUS + 2 < c.x + c.w)) {
            this.damage(time);
          }
        }
        continue;
      }
      if (time < row.start) continue;
      const rSurf = row.surfDir === -1 ? CEILING : FLOOR;

      if (row.kind === "lava") {
        const sx = this.spanX(row, time, row.surgeLen);
        if (sx <= -row.surgeLen || sx >= WIDTH) continue;
        const hitY = row.surfDir === 1
          ? state.y + SOUL_RADIUS - 2 > rSurf - row.surgeH
          : state.y - SOUL_RADIUS + 2 < rSurf + row.surgeH;
        if (hitY && state.x + SOUL_RADIUS - 2 > sx && state.x - SOUL_RADIUS + 2 < sx + row.surgeLen) {
          this.damage(time);
        }
        continue;
      }

      if (row.kind === "gate") {
        const gx = this.spanX(row, time, row.width);
        if (gx <= -row.width || gx >= WIDTH) continue;
        if (state.x + SOUL_RADIUS - 2 <= gx || state.x - SOUL_RADIUS + 2 >= gx + row.width) continue;
        // Low spike check
        const footDist = row.surfDir === 1 ? rSurf - (state.y + SOUL_RADIUS) : (state.y - SOUL_RADIUS) - rSurf;
        if (footDist < row.spikeH) {
          const halfW = (row.width / 2) * clamp((row.spikeH - footDist) / row.spikeH, 0, 1);
          if (Math.abs(state.x - gx - row.width / 2) < halfW + SOUL_RADIUS - 2) this.damage(time);
        }
        // Upper prism check
        const prismNear = rSurf - row.surfDir * row.prismBottom;
        const prismFar = prismNear - row.surfDir * row.prismThick;
        const yTop = Math.min(prismNear, prismFar);
        const yBot = Math.max(prismNear, prismFar);
        if (state.y + SOUL_RADIUS - 2 > yTop && state.y - SOUL_RADIUS + 2 < yBot) this.damage(time);
        continue;
      }

      this.forEachSpike(row, time, (x, {width, height}) => {
        const footDist = row.surfDir === 1 ? rSurf - (state.y + SOUL_RADIUS) : (state.y - SOUL_RADIUS) - rSurf;
        if (footDist >= height) return;
        const halfWidth = width * clamp((height - footDist) / height, 0, 1) / 2;
        if (Math.abs(state.x - x - width / 2) < halfWidth + SOUL_RADIUS - 2) this.damage(time);
      });
    }
  }

  drawSpike(ctx, x, width, height, surfY, surfDir) {
    const tipY = surfY - surfDir * height;
    ctx.fillStyle = "#ad5de9";
    ctx.beginPath();
    ctx.moveTo(x, surfY);
    ctx.lineTo(x + width / 2, tipY);
    ctx.lineTo(x + width, surfY);
    ctx.fill();
    ctx.fillStyle = this.insane ? PALETTE.insane : PALETTE.pink;
    ctx.beginPath();
    ctx.moveTo(x + width / 2, tipY);
    ctx.lineTo(x + width * 0.68, surfY);
    ctx.lineTo(x + width, surfY);
    ctx.fill();
  }

  draw(ctx, time, state, labels) {
    const {dir} = this.surfaceAt(time);
    const floorGlow = ctx.createLinearGradient(0, FLOOR, 0, HEIGHT);
    floorGlow.addColorStop(0, dir === 1 ? "#8a3cd14f" : "#3b1d5a22");
    floorGlow.addColorStop(1, "#100b1d");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, FLOOR, WIDTH, HEIGHT - FLOOR);
    ctx.fillStyle = dir === 1 ? PALETTE.lilac : "#7c52a8";
    ctx.fillRect(0, FLOOR, WIDTH, 2);

    if (this.flips.length) {
      const ceilGlow = ctx.createLinearGradient(0, 0, 0, CEILING);
      ceilGlow.addColorStop(0, "#100b1d");
      ceilGlow.addColorStop(1, dir === -1 ? "#e879f94f" : "#3b1d5a22");
      ctx.fillStyle = ceilGlow;
      ctx.fillRect(0, 0, WIDTH, CEILING);
      ctx.fillStyle = dir === -1 ? PALETTE.pink : "#7c52a8";
      ctx.fillRect(0, CEILING - 2, WIDTH, 2);
    }

    // Gravity flip warning banner
    const pendingFlip = this.flips.find(f => (time >= f.cueStart && time < f.start) || (time >= f.cueEnd && time < f.end));
    if (pendingFlip) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 24) ** 2;
      ctx.fillStyle = PALETTE.gold;
      ctx.font = "700 12px system-ui";
      ctx.textAlign = "center";
      const label = labels.gravFlip ?? "GRAVITY!";
      ctx.fillText(time < pendingFlip.start ? `▲ ${label} ▲` : `▼ ${label} ▼`, WIDTH / 2, HEIGHT / 2 - 44);
      ctx.restore();
    }

    const warning = this.cfg.warning;
    for (const row of this.rows) {
      if (row.kind === "stalactite") {
        if (time < row.cue) continue;
        const originY = row.surfDir === 1 ? CEILING : FLOOR;
        if (time < row.start) {
          ctx.save();
          ctx.fillStyle = "#fb718544";
          ctx.strokeStyle = PALETTE.crimson;
          ctx.setLineDash([4, 4]);
          for (const c of row.cols) {
            ctx.fillRect(c.x, CEILING, c.w, FLOOR - CEILING);
            ctx.strokeRect(c.x + 1, originY - (row.surfDir === 1 ? 0 : 12), c.w - 2, 12);
          }
          ctx.restore();
          continue;
        }
        const travel = (time - row.start) * row.speed;
        if (travel > FLOOR - CEILING + 80) continue;
        const tipY = row.surfDir === 1 ? CEILING + travel : FLOOR - travel;
        const tailY = row.surfDir === 1 ? tipY - 58 : tipY + 58;
        for (const c of row.cols) {
          ctx.fillStyle = "#be123c";
          ctx.beginPath();
          ctx.moveTo(c.x, tailY);
          ctx.lineTo(c.x + c.w / 2, tipY);
          ctx.lineTo(c.x + c.w, tailY);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = PALETTE.crimson;
          ctx.beginPath();
          ctx.moveTo(c.x + c.w / 2, tipY);
          ctx.lineTo(c.x + c.w, tailY);
          ctx.lineTo(c.x + c.w * 0.65, tailY);
          ctx.closePath();
          ctx.fill();
        }
        continue;
      }

      const rSurf = row.surfDir === -1 ? CEILING : FLOOR;
      if (row.kind === "lava") {
        if (time >= row.platStart) {
          const px = this.spanX(row, time, row.platW, row.platStart);
          if (px > -row.platW && px < WIDTH) {
            const py = rSurf - row.surfDir * PLAT_OFFSET;
            ctx.save();
            ctx.fillStyle = "#8ff3cbcc";
            ctx.shadowColor = PALETTE.mint;
            ctx.shadowBlur = 10;
            ctx.fillRect(px, py - 3, row.platW, 6);
            ctx.restore();
          }
        }
        if (time >= row.start - warning && time < row.start) {
          const len = 8 + 20 * (1 - (row.start - time) / warning);
          const wx = row.direction === 1 ? 8 : WIDTH - 8 - len;
          ctx.fillStyle = PALETTE.crimson;
          ctx.fillRect(wx, rSurf - (row.surfDir === 1 ? 8 : -2), len, 6);
          continue;
        }
        if (time >= row.start) {
          const sx = this.spanX(row, time, row.surgeLen);
          if (sx > -row.surgeLen && sx < WIDTH) {
            const sy = row.surfDir === 1 ? rSurf - row.surgeH : rSurf;
            ctx.save();
            ctx.fillStyle = "#e11d4899";
            ctx.fillRect(sx, sy, row.surgeLen, row.surgeH);
            ctx.fillStyle = "#fda4af";
            for (let rx = sx + 12; rx < sx + row.surgeLen - 12; rx += 22) {
              ctx.beginPath();
              ctx.moveTo(rx - 9, row.surfDir === 1 ? rSurf : rSurf);
              ctx.lineTo(rx, row.surfDir === 1 ? rSurf - row.surgeH - 5 : rSurf + row.surgeH + 5);
              ctx.lineTo(rx + 9, rSurf);
              ctx.fill();
            }
            ctx.restore();
          }
        }
        continue;
      }

      if (time < row.start - warning) continue;
      if (time < row.start) {
        const progress = 1 - (row.start - time) / warning;
        const length = 6 + 21 * progress;
        const x = row.direction === 1 ? 8 : WIDTH - 8 - length;
        ctx.fillStyle = row.kind === "gate" ? PALETTE.cyan : (this.insane ? PALETTE.insane : "#f0abfc");
        ctx.fillRect(x, rSurf - (row.surfDir === 1 ? 4 : 0), length, 4);
        continue;
      }

      if (row.kind === "gate") {
        const gx = this.spanX(row, time, row.width);
        if (gx <= -row.width || gx >= WIDTH) continue;
        this.drawSpike(ctx, gx, row.width, row.spikeH, rSurf, row.surfDir);
        const prismNear = rSurf - row.surfDir * row.prismBottom;
        const prismFar = prismNear - row.surfDir * row.prismThick;
        const yTop = Math.min(prismNear, prismFar);
        ctx.save();
        ctx.fillStyle = "#38bdf844";
        ctx.strokeStyle = PALETTE.cyan;
        ctx.lineWidth = 1.5;
        ctx.fillRect(gx, yTop, row.width, row.prismThick);
        ctx.strokeRect(gx, yTop, row.width, row.prismThick);
        ctx.restore();
        continue;
      }

      this.forEachSpike(row, time, (x, {width, height}) => this.drawSpike(ctx, x, width, height, rSurf, row.surfDir));
    }
    drawSoul(ctx, state, time, "#d185ff");
  }
}
