import {ArenaGame, HEIGHT, PALETTE, SOUL_RADIUS, WIDTH, clamp, crystal, drawSoul} from "./base.js";

const LEVELS = {
  easy: {warning: [0.96, 0.96], width: [34, 34], count: [1, 2], pause: [0.42, 0.42], crossChance: 0, moveSpeed: 215},
  medium: {warning: [0.80, 0.80], width: [38, 38], count: [2, 2], pause: [0.32, 0.32], crossChance: 0.28, moveSpeed: 225},
  hard: {warning: [0.50, 0.64], width: [50, 60], fireStep: [0.76, 1.05], crossChance: 0.68, moveSpeed: 248},
  insane: {warning: [0.40, 0.50], width: [54, 64], fireStep: [0.62, 0.82], crossChance: 0.85, moveSpeed: 270}
};

export class BeamsGame extends ArenaGame {
  constructor(session, onEvent) {
    super(session, onEvent);
    this.cfg = LEVELS[session.difficulty];
    this.attacks = [];
    if (this.hard || this.insane) this.buildCrossBeams();
    else this.buildStandardBeams();
    this.cues.sort((a, b) => a.time - b.time);
  }

  buildStandardBeams() {
    const {warning, width, count, pause, crossChance} = this.cfg;
    for (let cue = 0.38; cue + warning[0] + 0.35 <= this.duration;) {
      const warn = this.between(...warning);
      const fire = cue + warn;
      const end = fire + 0.35;
      const vertical = this.random() < 0.5;
      const cross = this.random() < crossChance;
      const primaryCount = Math.round(this.between(...count));
      this.addAttack(cue, fire, end, vertical, primaryCount, this.between(...width));
      if (cross) this.addAttack(cue, fire, end, !vertical, 1, this.between(...width));
      this.cues.push({time: cue, sound: "Telegraph"}, {time: fire, sound: "BeamFire"});
      cue = end + this.between(...pause);
    }
  }

  buildCrossBeams() {
    const {warning, width, fireStep, crossChance} = this.cfg;
    for (let fire = 0.66; fire < this.duration - 0.22; fire += this.between(...fireStep)) {
      const cue = Math.max(0.05, fire - this.between(...warning));
      const end = fire + this.between(0.22, 0.31);
      const vertical = this.random() < 0.5;
      const axes = this.random() < crossChance ? [vertical, !vertical] : [vertical];
      for (const axis of axes) {
        const count = this.insane
          ? (axis === vertical ? 3 : 2 + Number(this.random() < 0.75))
          : (axis === vertical ? 3 : 2 + Number(this.random() < 0.65));
        this.addAttack(cue, fire, end, axis, count, this.between(...width));
      }
      this.cues.push({time: cue, sound: "Telegraph"}, {time: fire, sound: "BeamFire"});
    }
  }

  addAttack(cue, fire, end, vertical, count, width) {
    const cross = vertical ? WIDTH : HEIGHT;
    // Parity candidates leave at least one safe corridor on every volley.
    const candidates = count > 3 || this.random() < 0.5 ? [0, 2, 4, 6] : [1, 3, 5];
    const safeCount = Math.min(count, candidates.length);
    const lanes = [];
    for (let i = 0; i < safeCount; i++) {
      const [lane] = candidates.splice(Math.floor(this.random() * candidates.length), 1);
      let center = (lane + 0.5) * cross / 7;
      if (this.hard || this.insane) {
        if (lane === 0) center = 21;
        if (lane === 6) center = cross - 21;
        center += this.between(-5, 5);
      }
      lanes.push(center);
    }
    this.attacks.push({cue, fire, end, vertical, lanes, width});
  }

  update(dt, time, input) {
    this.moveFree(dt, input, this.cfg.moveSpeed, time);
    for (const attack of this.attacks) {
      if (time < attack.fire || time >= attack.end) continue;
      const cross = attack.vertical ? this.state.x : this.state.y;
      if (attack.lanes.some(lane => Math.abs(cross - lane) < attack.width / 2 + SOUL_RADIUS)) this.damage(time);
    }
  }

  draw(ctx, time, state) {
    const fireGlow = this.insane ? PALETTE.insane : PALETTE.pink;
    const fireFill = this.insane ? "#ff5c7cbb" : "#c084fcbb";
    for (const attack of this.attacks) {
      if (time < attack.cue || time >= attack.end) continue;
      const aiming = time < attack.fire;
      const progress = aiming ? clamp((time - attack.cue) / (attack.fire - attack.cue), 0, 1) : 1;
      for (const lane of attack.lanes) {
        ctx.save();
        if (aiming) {
          // Warm amber/gold lock-on rails converging inward before white-magenta plasma fires
          ctx.fillStyle = `rgba(245, 158, 11, ${0.12 + progress * 0.16})`;
          if (attack.vertical) ctx.fillRect(lane - attack.width / 2, 0, attack.width, HEIGHT);
          else ctx.fillRect(0, lane - attack.width / 2, WIDTH, attack.width);

          const railOffset = (attack.width / 2) * (1 - progress * 0.72);
          ctx.strokeStyle = PALETTE.gold;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 22) ** 2;
          ctx.beginPath();
          if (attack.vertical) {
            ctx.moveTo(lane - railOffset, 0); ctx.lineTo(lane - railOffset, HEIGHT);
            ctx.moveTo(lane + railOffset, 0); ctx.lineTo(lane + railOffset, HEIGHT);
          } else {
            ctx.moveTo(0, lane - railOffset); ctx.lineTo(WIDTH, lane - railOffset);
            ctx.moveTo(0, lane + railOffset); ctx.lineTo(WIDTH, lane + railOffset);
          }
          ctx.stroke();

          ctx.strokeStyle = "#fde68a";
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          if (attack.vertical) { ctx.moveTo(lane, 0); ctx.lineTo(lane, HEIGHT); }
          else { ctx.moveTo(0, lane); ctx.lineTo(WIDTH, lane); }
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.shadowColor = fireGlow;
          ctx.shadowBlur = 22;
          ctx.fillStyle = fireFill;
          if (attack.vertical) ctx.fillRect(lane - attack.width / 2, 0, attack.width, HEIGHT);
          else ctx.fillRect(0, lane - attack.width / 2, WIDTH, attack.width);

          ctx.fillStyle = "#fff4ff";
          if (attack.vertical) ctx.fillRect(lane - 2.5, 0, 5, HEIGHT);
          else ctx.fillRect(0, lane - 2.5, WIDTH, 5);
        }

        const emitterColor = aiming ? PALETTE.gold : fireGlow;
        if (attack.vertical) {
          crystal(ctx, lane, 11, 9, 12, emitterColor);
          crystal(ctx, lane, HEIGHT - 11, 9, 12, emitterColor);
        } else {
          crystal(ctx, 11, lane, 12, 9, emitterColor);
          crystal(ctx, WIDTH - 11, lane, 12, 9, emitterColor);
        }
        ctx.restore();
      }
    }
    drawSoul(ctx, state, time);
  }
}
