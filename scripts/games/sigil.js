import {ArenaGame, HEIGHT, PALETTE, WIDTH} from "./base.js";

export const SIGIL_RULES = {
  easy: {length: 7, invertChance: 0},
  medium: {length: 10, invertChance: 0.15},
  hard: {length: 13, invertChance: 0.30},
  insane: {length: 16, invertChance: 0.45}
};

const ARROWS = ["↑", "→", "↓", "←"];

export class SigilGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.rules = SIGIL_RULES[session.difficulty];
    this.lastWrongAt = -1;
    this.sequence = this.buildSequence();
    this.hasInverted = this.sequence.some(item => item.inverted);
    if (this.sequence.length) {
      this.state.x = this.sequence[0].tx;
      this.state.y = this.sequence[0].ty;
    }
  }

  buildSequence() {
    const {length, invertChance} = this.rules;
    const rows = length <= 8 ? 1 : 2;
    const topCount = rows === 1 ? length : Math.ceil(length / 2);
    const step = 48;
    const size = length <= 8 ? 38 : 36;
    const seq = [];

    for (let i = 0; i < length; i++) {
      let dir = Math.floor(this.random() * 4);
      let inverted = this.random() < invertChance;
      if (i >= 2 && seq[i - 1].dir === dir && seq[i - 2].dir === dir
        && seq[i - 1].inverted === inverted && seq[i - 2].inverted === inverted) {
        dir = (dir + 1 + Math.floor(this.random() * 3)) % 4;
      }

      const row = rows === 1 ? 0 : Number(i >= topCount);
      const countInRow = rows === 1 ? length : (row === 0 ? topCount : length - topCount);
      const col = row === 0 ? i : i - topCount;
      const startX = WIDTH / 2 - ((countInRow - 1) / 2) * step;
      const ty = rows === 1 ? HEIGHT / 2 : (row === 0 ? 148 : 216);

      seq.push({dir, inverted, tx: startX + col * step, ty, size});
    }
    return seq;
  }

  press(action, time) {
    if (this.result || !action.startsWith("dir")) return;
    const pressedDir = Number(action.slice(3));
    if (!Number.isInteger(pressedDir) || pressedDir < 0 || pressedDir > 3) return;

    const idx = this.state.progress;
    const rune = this.sequence[idx];
    if (!rune) return;

    this.state.x = rune.tx;
    this.state.y = rune.ty;
    const expected = rune.inverted ? (rune.dir + 2) % 4 : rune.dir;
    if (pressedDir === expected) {
      this.state.progress++;
      this.onEvent("timingHit");
      if (this.state.progress >= this.rules.length) {
        this.finish(true, "sigil", time);
      } else {
        const next = this.sequence[this.state.progress];
        this.state.x = next.tx;
        this.state.y = next.ty;
      }
    } else {
      this.lastWrongAt = time;
      this.damage(time, 0.25);
    }
  }

  step(dt, time) {
    if (this.result) return;
    this.currentTime = time;
    if (time >= this.duration) this.finish(false, "timeout", time);
  }

  draw(ctx, time, state, labels = {}) {
    if (this.hasInverted) {
      ctx.save();
      ctx.fillStyle = "#fda4af";
      ctx.font = "700 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(labels.sigilInvert ?? "⇄ Crimson = press opposite", WIDTH / 2, 54);
      ctx.restore();
    }

    for (let i = 0; i < this.sequence.length; i++) {
      const rune = this.sequence[i];
      const done = i < state.progress;
      const active = i === state.progress;
      const half = rune.size / 2;

      ctx.save();
      if (active) {
        const pulse = 3 + Math.sin(time * 12) * 1.5;
        ctx.strokeStyle = rune.inverted ? PALETTE.crimson : PALETTE.gold;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 7;
        ctx.strokeRect(rune.tx - half - pulse, rune.ty - half - pulse, rune.size + pulse * 2, rune.size + pulse * 2);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeRect(rune.tx - half - pulse, rune.ty - half - pulse, rune.size + pulse * 2, rune.size + pulse * 2);
      }

      ctx.fillStyle = done ? "#064e3bcc" : rune.inverted ? "#4c0519d9" : active ? "#3b1d5fe6" : "#1c102ccc";
      ctx.strokeStyle = done ? PALETTE.mint : rune.inverted ? PALETTE.crimson : active ? PALETTE.gold : "#7c52a8";
      ctx.lineWidth = active ? 2.2 : 1.4;
      ctx.fillRect(rune.tx - half, rune.ty - half, rune.size, rune.size);
      ctx.strokeRect(rune.tx - half, rune.ty - half, rune.size, rune.size);

      ctx.fillStyle = done ? PALETTE.mint : rune.inverted ? "#fda4af" : active ? "#fff8dc" : "#d8c2ee";
      ctx.font = `800 ${active ? 20 : 18}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ARROWS[rune.dir], rune.tx, rune.ty + 1);

      if (rune.inverted && !done) {
        ctx.fillStyle = PALETTE.crimson;
        ctx.font = "700 9px system-ui";
        ctx.fillText("⇄", rune.tx + half - 6, rune.ty - half + 7);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "#d9c2ef";
    ctx.font = "600 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${state.progress} / ${this.rules.length}`, WIDTH / 2, HEIGHT - 46);
    ctx.restore();
  }
}
