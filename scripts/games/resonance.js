import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, drawSoul} from "./base.js";

const LEVELS = {
  easy: {speed: [340, 360], warning: [0.78, 0.78], width: [24, 28], pause: [0.22, 0.28], continuous: false, dualChance: 0},
  medium: {speed: [420, 460], warning: [0.62, 0.62], width: [28, 34], pause: [0.16, 0.22], continuous: false, dualChance: 0.15},
  hard: {speed: [610, 760], warning: [0.38, 0.48], width: [34, 46], pause: [0.14, 0.22], continuous: true, dualChance: 0.28},
  insane: {speed: [720, 900], warning: [0.30, 0.40], width: [38, 52], pause: [0.10, 0.16], continuous: true, dualChance: 0.42}
};

export class ResonanceGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.waves = [];
    this.buildWaves();
    this.cues.sort((a, b) => a.time - b.time);
  }

  buildWaves() {
    let amber = this.random() < 0.5;
    let streak = 0;
    let prevAmber = null;
    let prevVertical = null;
    let prevDirection = null;
    let start = this.hard || this.insane ? 0.50 : 0.92;

    while (start < this.duration - 0.52) {
      const warn = this.between(...this.cfg.warning);
      if (prevAmber !== null && amber !== prevAmber) {
        const minSwitchPause = this.insane ? 0.18 : 0.24;
        const lastEnd = this.waves.at(-1)?.end ?? 0;
        const sameAxisReverse = prevVertical !== null && prevDirection !== null;
        if (sameAxisReverse || this.hard || this.insane) {
          start = Math.max(start, lastEnd + minSwitchPause);
        }
      }
      if (start >= this.duration - 0.52) break;

      const cue = Math.max(0.05, start - warn);
      const vertical = this.random() < 0.5;
      const dual = this.random() < this.cfg.dualChance;
      const axes = dual ? [vertical, !vertical] : [vertical];
      let end = start;

      for (const acrossX of axes) {
        const axis = acrossX ? WIDTH : HEIGHT;
        const speed = this.between(...this.cfg.speed);
        const width = this.between(...this.cfg.width);
        const lag = acrossX === vertical ? 0 : this.between(0.05, 0.12);
        const waveStart = start + lag;
        const waveEnd = waveStart + (axis + width * 2) / speed;
        const dir = this.direction;
        this.waves.push({
          cue: cue + lag,
          start: waveStart,
          end: waveEnd,
          vertical: acrossX,
          axis,
          speed,
          width,
          amber,
          direction: dir,
          resolved: false
        });
        end = Math.max(end, waveEnd);
        prevVertical = acrossX;
        prevDirection = dir;
      }

      this.cues.push({time: cue, sound: "Telegraph"});
      prevAmber = amber;
      start = end + this.between(...this.cfg.pause);
      if (++streak === 2 || this.random() < 0.68) {
        amber = !amber;
        streak = 0;
      }
    }
  }

  position(wave, time) {
    const distance = (time - wave.start) * wave.speed - wave.width;
    return wave.direction === 1 ? distance : wave.axis - distance;
  }

  update(dt, time, input) {
    this.moveFree(dt, input, 218, time);
    const inputActive = Math.hypot(input.x, input.y) > 0;
    const movingForAmber = this.state.moving || (inputActive && time - this.lastMoveTime < 0.075);

    for (const wave of this.waves) {
      if (wave.resolved || time < wave.start || time >= wave.end) continue;
      const along = wave.vertical ? this.state.x : this.state.y;
      if (Math.abs(along - this.position(wave, time)) > wave.width / 2 + SOUL_RADIUS) continue;
      const isMoving = wave.amber ? movingForAmber : this.state.moving;
      const wrong = isMoving !== wave.amber;
      if (!this.cfg.continuous || wrong) wave.resolved = true;
      if (wrong) this.damage(time);
    }
  }

  draw(ctx, time, state) {
    for (const wave of this.waves) {
      if (time < wave.cue || time >= wave.end) continue;
      const color = wave.amber ? PALETTE.amber : PALETTE.blue;
      const warning = time < wave.start;
      const center = warning ? (wave.direction === 1 ? 6 : wave.axis - 6) : this.position(wave, time);
      const thickness = warning ? 8 : wave.width;

      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.globalAlpha = warning ? 0.5 + 0.4 * Math.sin(time * 16) ** 2 : 0.42;
      if (wave.vertical) ctx.fillRect(center - thickness / 2, 0, thickness, HEIGHT);
      else ctx.fillRect(0, center - thickness / 2, WIDTH, thickness);

      ctx.globalAlpha = 0.92;
      if (warning) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        if (wave.vertical) {
          ctx.moveTo(center, 0);
          ctx.lineTo(center, HEIGHT);
        } else {
          ctx.moveTo(0, center);
          ctx.lineTo(WIDTH, center);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Core line + intuitive pattern overlay (chevrons for move/amber, freeze bars for still/blue)
        if (wave.vertical) ctx.fillRect(center - 1, 0, 2, HEIGHT);
        else ctx.fillRect(0, center - 1, WIDTH, 2);

        ctx.strokeStyle = "#ffffff99";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (wave.amber) {
          const step = 34;
          const dir = wave.direction;
          if (wave.vertical) {
            for (let y = 18; y < HEIGHT; y += step) {
              ctx.moveTo(center - dir * 5, y - 6);
              ctx.lineTo(center + dir * 5, y);
              ctx.lineTo(center - dir * 5, y + 6);
            }
          } else {
            for (let x = 18; x < WIDTH; x += step) {
              ctx.moveTo(x - 6, center - dir * 5);
              ctx.lineTo(x, center + dir * 5);
              ctx.lineTo(x + 6, center - dir * 5);
            }
          }
        } else {
          const step = 30;
          if (wave.vertical) {
            for (let y = 15; y < HEIGHT; y += step) {
              ctx.moveTo(center - 5, y);
              ctx.lineTo(center + 5, y);
            }
          } else {
            for (let x = 15; x < WIDTH; x += step) {
              ctx.moveTo(x, center - 5);
              ctx.lineTo(x, center + 5);
            }
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    drawSoul(ctx, state, time);
  }
}
