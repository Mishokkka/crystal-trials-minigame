import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, drawSoul} from "./base.js";

const LEVELS = {
  easy: {speed: [440, 500], warning: [0.50, 0.50], width: [24, 28], pause: [0.06, 0.10], continuous: false, dualChance: 0, ringChance: 0, chainChance: 0.35},
  medium: {speed: [550, 630], warning: [0.42, 0.42], width: [28, 34], pause: [0.05, 0.09], continuous: false, dualChance: 0.25, ringChance: 0.25, chainChance: 0.48},
  hard: {speed: [700, 860], warning: [0.32, 0.38], width: [34, 46], pause: [0.04, 0.08], continuous: true, dualChance: 0.38, ringChance: 0.30, chainChance: 0.60},
  insane: {speed: [840, 1040], warning: [0.25, 0.32], width: [38, 52], pause: [0.03, 0.06], continuous: true, dualChance: 0.50, ringChance: 0.35, chainChance: 0.72}
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
    let chainCount = 0;
    let groupEnd = 0;
    let start = this.hard || this.insane ? 0.36 : 0.50;

    while (start < this.duration - 0.38) {
      const warn = this.between(...this.cfg.warning);
      const cue = Math.max(0.05, start - warn);
      let end = start;

      if (this.random() < this.cfg.ringChance) {
        const speed = this.between(...this.cfg.speed) * 0.72;
        const width = this.between(...this.cfg.width);
        const waveEnd = start + (305 + width) / speed;
        this.waves.push({
          kind: "ring",
          cue,
          start,
          end: waveEnd,
          speed,
          width,
          amber,
          resolved: false
        });
        end = waveEnd;
      } else {
        const vertical = this.random() < 0.5;
        const dual = this.random() < this.cfg.dualChance;
        const axes = dual ? [vertical, !vertical] : [vertical];
        for (const acrossX of axes) {
          const axis = acrossX ? WIDTH : HEIGHT;
          const speed = this.between(...this.cfg.speed);
          const width = this.between(...this.cfg.width);
          const lag = acrossX === vertical ? 0 : this.between(0.05, 0.11);
          const waveStart = start + lag;
          const waveEnd = waveStart + (axis + width * 2) / speed;
          this.waves.push({
            kind: "line",
            cue: cue + lag,
            start: waveStart,
            end: waveEnd,
            vertical: acrossX,
            axis,
            speed,
            width,
            amber,
            direction: this.direction,
            resolved: false
          });
          end = Math.max(end, waveEnd);
        }
      }

      this.cues.push({time: cue, sound: "Telegraph"});
      groupEnd = Math.max(groupEnd, end);
      chainCount++;

      // Staggered same-color barrage increases density without conflicting overlaps
      if (chainCount < 3 && this.random() < this.cfg.chainChance) {
        start += this.between(0.28, 0.42);
      } else {
        const minSwitchPause = this.insane ? 0.14 : this.hard ? 0.18 : 0.14;
        amber = !amber;
        chainCount = 0;
        start = Math.max(groupEnd + this.between(...this.cfg.pause), groupEnd + minSwitchPause);
      }
    }
  }

  position(wave, time) {
    if (wave.kind === "ring") return (time - wave.start) * wave.speed - wave.width * 0.5;
    const distance = (time - wave.start) * wave.speed - wave.width;
    return wave.direction === 1 ? distance : wave.axis - distance;
  }

  update(dt, time, input) {
    this.moveFree(dt, input, 224, time);
    const inputActive = Math.hypot(input.x, input.y) > 0;
    const movingForAmber = this.state.moving || (inputActive && time - this.lastMoveTime < 0.075);

    for (const wave of this.waves) {
      if (wave.resolved || time < wave.start || time >= wave.end) continue;
      if (wave.kind === "ring") {
        const dist = Math.hypot(this.state.x - WIDTH / 2, this.state.y - HEIGHT / 2);
        if (Math.abs(dist - this.position(wave, time)) > wave.width / 2 + SOUL_RADIUS) continue;
      } else {
        const along = wave.vertical ? this.state.x : this.state.y;
        if (Math.abs(along - this.position(wave, time)) > wave.width / 2 + SOUL_RADIUS) continue;
      }
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

      ctx.save();

      if (wave.kind === "ring") {
        if (warning) {
          const pulseAlpha = 0.55 + 0.4 * Math.sin(time * 18) ** 2;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(WIDTH / 2, HEIGHT / 2, 22, 0, Math.PI * 2);
          ctx.lineWidth = 10;
          ctx.globalAlpha = pulseAlpha * 0.22;
          ctx.stroke();
          ctx.lineWidth = 4;
          ctx.globalAlpha = pulseAlpha;
          ctx.setLineDash([7, 5]);
          ctx.stroke();
        } else {
          const r = this.position(wave, time);
          if (r > 0) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(WIDTH / 2, HEIGHT / 2, r, 0, Math.PI * 2);
            ctx.lineWidth = wave.width + 14;
            ctx.globalAlpha = 0.14;
            ctx.stroke();

            ctx.lineWidth = wave.width;
            ctx.globalAlpha = 0.38;
            ctx.stroke();

            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = "#ffffffaa";
            ctx.lineWidth = 2;
            if (!wave.amber) ctx.setLineDash([6, 8]);
            ctx.stroke();
          }
        }
        ctx.restore();
        continue;
      }

      const center = warning ? (wave.direction === 1 ? 6 : wave.axis - 6) : this.position(wave, time);
      const thickness = warning ? 8 : wave.width;
      const baseAlpha = warning ? 0.5 + 0.4 * Math.sin(time * 16) ** 2 : 0.42;
      ctx.fillStyle = color;
      ctx.globalAlpha = warning ? baseAlpha * 0.25 : 0.14;
      if (wave.vertical) ctx.fillRect(center - (thickness + 14) / 2, 0, thickness + 14, HEIGHT);
      else ctx.fillRect(0, center - (thickness + 14) / 2, WIDTH, thickness + 14);

      ctx.globalAlpha = baseAlpha;
      if (wave.vertical) ctx.fillRect(center - thickness / 2, 0, thickness, HEIGHT);
      else ctx.fillRect(0, center - thickness / 2, WIDTH, thickness);

      ctx.globalAlpha = 0.92;
      if (warning) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        if (wave.vertical) { ctx.moveTo(center, 0); ctx.lineTo(center, HEIGHT); }
        else { ctx.moveTo(0, center); ctx.lineTo(WIDTH, center); }
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
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
