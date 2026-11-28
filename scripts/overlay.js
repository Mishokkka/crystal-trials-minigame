import {GAMES} from "./games/index.js";
import {HEIGHT, WIDTH, arenaBackground, clamp, crystal} from "./games/base.js";
import {MODULE_ID, element, serverTime, setting, t} from "./shared.js";
import {SoundManager} from "./sound-manager.js";

const LEFT = ["KeyA", "ArrowLeft"];
const RIGHT = ["KeyD", "ArrowRight"];
const UP = ["KeyW", "ArrowUp"];
const DOWN = ["KeyS", "ArrowDown"];
const JUMP = [...UP, "Space"];

function codeToDir(code) {
  if (UP.includes(code)) return 0;
  if (RIGHT.includes(code)) return 1;
  if (DOWN.includes(code)) return 2;
  if (LEFT.includes(code)) return 3;
  return -1;
}
const BLOCKED = new Set([
  ...LEFT, ...RIGHT, ...UP, ...DOWN, "Space", "Escape", "Delete", "Backspace",
  "Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
  "KeyP", "KeyM", "KeyC", "KeyI", "KeyE", "KeyF", "KeyR", "KeyG"
]);
const STEP = 1 / 120;
const SEND_INTERVAL = 50;
const BG_TICK_MS = 80;
const RAF_STALL_MS = 120;
const STALL_THRESHOLD_SEC = 0.12;
const MAX_SNAPSHOTS = 16;
const TRAIL_LENGTH = 20;
export const CLOSE_MS = 240;

export class TrialOverlay {
  constructor(session, {activeUserId = null, getNow = serverTime, isGM = false, publishState, publishResult, onAbort, onClosed}) {
    this.session = session;
    this.activeUserId = activeUserId;
    this.getNow = getNow;
    this.isGM = isGM;
    this.publishState = publishState;
    this.publishResult = publishResult;
    this.onAbort = onAbort;
    this.onClosed = onClosed;
    this.sound = new SoundManager();
    this.listeners = new AbortController();
    this.keys = new Set();
    this.labels = {
      start: t("Overlay.MazeStart"),
      finish: t("Overlay.MazeFinish"),
      perfect: t("Overlay.Perfect"),
      hitOk: t("Overlay.HitOk"),
      miss: t("Overlay.Miss"),
      gravFlip: t("Overlay.GravFlip"),
      sigilInvert: t("Overlay.SigilInvert")
    };
    this.number = new Intl.NumberFormat(game.i18n.lang, {minimumFractionDigits: 1, maximumFractionDigits: 1});
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.pointer = null;
    this.time = 0;
    this.simulated = 0;
    this.cueIndex = 0;
    this.started = false;
    this.finished = false;
    this.closed = false;
    this.pausedCanvasTicker = false;
    this.lastRaf = 0;
    this.bgTimer = null;
    this.shieldDir = -1;
    this.goUntil = -Infinity;
    this.clockTenth = null;
    this.clockLow = null;
    this.perfWindowStart = 0;
    this.perfFrames = 0;
    this.perfPaintSum = 0;
    this.perfPaintMax = 0;

    this.slots = session.targets.map((target, index) => {
      const slot = {
        index,
        userId: target.userId,
        name: target.name,
        color: target.color,
        active: target.userId === activeUserId,
        game: null,
        view: null,
        snapshots: [],
        lastSnapshotAt: 0,
        renderTime: 0,
        localTrail: [],
        particles: [],
        shake: 0,
        flash: null,
        result: null,
        displayedLives: session.lives,
        sequence: 0,
        lastSend: -Infinity,
        lastTimeScale: null,
        timeLow: null,
        statusKey: null
      };
      slot.game = new GAMES[session.gameType].Game(session, (event, timingStrike) => this.handleSlotEvent(slot, event, timingStrike));
      slot.view = {...slot.game.state};
      if (session.gameType === "maze") slot.localTrail = [slot.game.origin];
      return slot;
    });
    this.slotMap = new Map(this.slots.map(slot => [slot.userId, slot]));
    this.activeSlot = this.slots.find(slot => slot.active) ?? null;
    this.primarySlot = this.activeSlot ?? this.slots[0];
  }

  open() {
    const {gameType, customTitle, lives, difficulty} = this.session;
    const modeName = t(`Games.${gameType}.Name`);
    const duo = this.slots.length > 1;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);

    this.root = element("dialog", `ct-dialog ct-diff-${difficulty}`);
    const title = element("h2", "ct-title", customTitle || modeName);
    title.id = "ct-trial-title";
    this.root.setAttribute("aria-labelledby", title.id);

    const panel = element("section", `ct-panel${duo ? " ct-duo" : ""}`);
    panel.tabIndex = -1;
    panel.setAttribute("autofocus", "");

    const header = element("header", "ct-header");
    const emblem = element("span", "ct-emblem");
    emblem.setAttribute("aria-hidden", "true");
    const identity = element("div", "ct-identity");
    const subRow = element("div", "ct-subrow");
    subRow.append(element("span", "ct-mode", modeName));
    subRow.append(element("span", `ct-diff-badge ct-diff-${difficulty}`, t(`Difficulty.${difficulty}`)));
    if (this.session.localOnly) subRow.append(element("span", "ct-local-badge", t("Chat.LocalBadge")));
    identity.append(title, subRow);

    const headerActions = element("div", "ct-header-actions");
    this.clock = element("span", "ct-clock");
    this.muteButton = element("button", "ct-mute-btn");
    this.muteButton.type = "button";
    this.updateMuteButton();
    headerActions.append(this.clock, this.muteButton);
    if (this.isGM) {
      this.abortButton = element("button", "ct-quick-abort", t("Launcher.Abort"));
      this.abortButton.type = "button";
      headerActions.append(this.abortButton);
    }
    header.append(emblem, identity, headerActions);

    const arenas = element("div", "ct-arenas");
    for (const slot of this.slots) {
      const card = element("article", `ct-slot ${slot.active ? "ct-slot-active" : "ct-slot-spectator"}`);
      const slotHead = element("div", "ct-slot-head");
      const playerBox = element("div", "ct-slot-player");
      const dot = element("span", "ct-player-dot");
      dot.style.background = slot.color;
      const role = element("span", "ct-role-badge", t(slot.active ? "Overlay.RoleActive" : "Overlay.RoleSpectator"));
      const nameNode = element("span", "ct-slot-name", slot.name);
      playerBox.append(dot, role, nameNode);

      const health = element("div", "ct-health");
      health.setAttribute("role", "img");
      health.setAttribute("aria-label", t("Overlay.Lives", {lives, max: lives}));
      const pips = Array.from({length: lives}, () => element("span", "ct-pip"));
      health.append(...pips);
      slotHead.append(playerBox, health);

      const stage = element("div", "ct-stage");
      const canvas = element("canvas", "ct-canvas");
      canvas.setAttribute("aria-label", `${modeName} — ${slot.name}`);
      canvas.width = Math.round(WIDTH * scale);
      canvas.height = Math.round(HEIGHT * scale);
      const ctx = canvas.getContext("2d", {alpha: false}) || canvas.getContext("2d");
      ctx.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
      const backdrop = element("canvas");
      backdrop.width = canvas.width;
      backdrop.height = canvas.height;
      const bctx = backdrop.getContext("2d", {alpha: false}) || backdrop.getContext("2d");
      bctx.scale(canvas.width / WIDTH, canvas.height / HEIGHT);
      arenaBackground(bctx);

      const banner = element("div", "ct-banner");
      banner.setAttribute("aria-live", "polite");
      const bannerTitle = element("strong", "ct-banner-title");
      const bannerDetail = element("span", "ct-banner-detail");
      const bannerHint = element("span", "ct-banner-hint");
      banner.append(bannerTitle, bannerDetail, bannerHint);

      const timeBar = element("div", "ct-timebar");
      const timeFill = element("div", "ct-timebar-fill");
      timeBar.append(timeFill);

      stage.append(canvas, timeBar, banner);
      const status = element("p", "ct-status", t(`Games.${gameType}.Help`));
      card.append(slotHead, stage, status);
      arenas.append(card);

      Object.assign(slot, {
        card, health, pips, canvas, ctx, backdrop, banner, bannerTitle, bannerDetail, bannerHint, timeFill, status
      });
    }

    panel.append(header);
    if (gameType === "resonance") {
      const legend = element("div", "ct-legend");
      legend.append(element("span", "ct-legend-blue", t("Overlay.Blue")), element("span", "ct-legend-amber", t("Overlay.Amber")));
      panel.append(legend);
    }
    panel.append(arenas);
    this.root.append(panel);

    this.bindInput();
    game.keyboard?.releaseKeys();
    document.body.append(this.root);
    this.root.showModal();
    panel.focus({preventScroll: true});
    if (typeof canvas !== "undefined" && canvas?.ready && canvas?.app?.ticker?.started) {
      this.pausedCanvasTicker = true;
      canvas.app.ticker.stop();
    }
    if (!setting("muteLocal")) void this.sound.preload();
    this.sound.play("Open");
    this.frame(performance.now());
    this.bgTimer = setInterval(() => this.backgroundTick(), BG_TICK_MS);
  }

  updateMuteButton() {
    if (!this.muteButton) return;
    const muted = Boolean(setting("muteLocal"));
    const label = t(muted ? "Overlay.Unmute" : "Overlay.Mute");
    this.muteButton.setAttribute("aria-pressed", String(muted));
    this.muteButton.setAttribute("aria-label", label);
    this.muteButton.title = label;
    this.muteButton.replaceChildren(element("i", `fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"}`));
  }

  bindInput() {
    const signal = this.listeners.signal;
    const capture = {signal, capture: true};
    window.addEventListener("keydown", event => this.key(event, true), capture);
    window.addEventListener("keyup", event => this.key(event, false), capture);
    window.addEventListener("blur", () => this.clearInput(), {signal});
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearInput();
    }, {signal});
    this.root.addEventListener("cancel", event => event.preventDefault(), {signal});
    this.root.addEventListener("close", () => {
      if (this.closed) return;
      if (!this.finished) {
        try {
          this.root.showModal();
          return;
        } catch {
          // Fall through to clean teardown if dialog cannot re-open
        }
      }
      this.close();
    }, {signal});

    this.abortButton?.addEventListener("click", () => {
      try {
        this.onAbort();
      } catch (error) {
        ui.notifications?.warn(error.message);
      }
    }, {signal});

    this.muteButton?.addEventListener("click", async () => {
      try {
        await game.settings.set(MODULE_ID, "muteLocal", !setting("muteLocal"));
        this.updateMuteButton();
        this.sound.refresh();
      } catch (error) {
        ui.notifications?.warn(error.message);
      }
    }, {signal});

    for (const type of ["pointermove", "mousemove", "wheel"]) {
      this.root.addEventListener(type, event => event.stopPropagation(), {signal});
    }
    const active = this.activeSlot;
    if (!active) return;
    if (this.session.gameType === "maze") {
      active.canvas.addEventListener("pointermove", event => this.updatePointer(event), {signal});
      active.canvas.addEventListener("pointerdown", event => this.updatePointer(event), {signal});
      active.canvas.addEventListener("pointerleave", () => this.leavePointer(), {signal});
      active.canvas.addEventListener("pointercancel", () => this.leavePointer(), {signal});
    } else if (this.session.gameType === "timing") {
      active.canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0 || this.finished || active.result) return;
        this.advance(this.getNow());
        this.press("timing");
      }, {signal});
    } else if (this.session.gameType === "aim") {
      const toPoint = event => {
        const rect = active.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
          x: clamp((event.clientX - rect.left) * WIDTH / rect.width, 0, WIDTH),
          y: clamp((event.clientY - rect.top) * HEIGHT / rect.height, 0, HEIGHT)
        };
      };
      active.canvas.addEventListener("pointermove", event => {
        if (!event.isPrimary || this.finished || active.result) return;
        const pt = toPoint(event);
        if (pt) active.game.movePointer(pt);
      }, {signal});
      active.canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary || this.finished || active.result) return;
        const pt = toPoint(event);
        if (!pt) return;
        this.advance(this.getNow());
        if (this.started && !active.result && !this.finished) {
          active.game.clickPointer(pt, this.time);
          this.finishIfNeeded();
        }
      }, {signal});
    }
  }

  held(codes) {
    return codes.some(code => this.keys.has(code));
  }

  key(event, down) {
    if (!BLOCKED.has(event.code)) return;
    event.stopImmediatePropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (!down) this.keys.delete(event.code);
      return;
    }
    event.preventDefault();
    const activeEl = document.activeElement;
    if (activeEl && (activeEl === this.abortButton || activeEl === this.muteButton)) {
      if (event.code === "Space" && down && !event.repeat) activeEl.click();
      return;
    }
    const active = this.activeSlot;
    if (!active || active.result || this.finished) return;
    if (down && (event.repeat || this.keys.has(event.code))) return;

    this.advance(this.getNow());
    if (active.result || this.finished) return;

    const alreadyJumping = this.held(JUMP);
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);

    const dir = codeToDir(event.code);
    if (down && dir >= 0) {
      this.shieldDir = dir;
    } else if (!down && !this.started && dir >= 0) {
      this.shieldDir = this.held(UP) ? 0 : this.held(RIGHT) ? 1 : this.held(DOWN) ? 2 : this.held(LEFT) ? 3 : -1;
    }

    if (!this.started) return;
    if (down) {
      const gt = this.session.gameType;
      if (event.code === "Space" && gt === "timing") this.press("timing");
      if (JUMP.includes(event.code) && !alreadyJumping && gt === "gravity") this.press("jump");
      if (dir >= 0 && (gt === "shield" || gt === "sigil")) this.press(`dir${dir}`);
    }
  }

  clearInput() {
    this.keys.clear();
    this.shieldDir = -1;
    this.leavePointer();
  }

  leavePointer() {
    this.pointer = null;
    const active = this.activeSlot;
    if (active && this.started && !active.result && !this.finished && active.game.state.tracking) {
      active.game.leavePointer();
      this.sendState(active);
    }
  }

  updatePointer(event) {
    const active = this.activeSlot;
    if (!active || active.result || this.finished || !event.isPrimary) return;
    const rect = active.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const samples = event.getCoalescedEvents?.() ?? [];
    this.advance(this.getNow());
    for (const sample of samples.length ? samples : [event]) {
      if (active.result || this.finished) break;
      const rawX = (sample.clientX - rect.left) * WIDTH / rect.width;
      const rawY = (sample.clientY - rect.top) * HEIGHT / rect.height;
      if (rawX < 0 || rawX >= WIDTH || rawY < 0 || rawY >= HEIGHT) {
        if (active.game.state.tracking) {
          active.game.movePointer({x: clamp(rawX, 0, WIDTH - 1), y: clamp(rawY, 0, HEIGHT - 1)}, this.time);
        }
        this.leavePointer();
        continue;
      }
      this.pointer = {x: rawX, y: rawY};
      if (this.started && !active.result) active.game.movePointer(this.pointer, this.time);
    }
    this.finishIfNeeded();
  }

  press(action) {
    const active = this.activeSlot;
    if (!active || !this.started || active.result || this.finished) return;
    active.game.press(action, this.time);
    this.finishIfNeeded();
  }

  triggerPop(node) {
    if (!node || this.reducedMotion) return;
    node.classList.remove("ct-pop");
    void node.offsetWidth;
    node.classList.add("ct-pop");
  }

  advance(now) {
    if (this.finished) return;
    const remaining = this.session.startAtTimestamp - now;
    if (remaining > 0 && !this.started) {
      const count = Math.min(this.session.countdownSec, Math.ceil(remaining / 1000));
      if (count !== this.count) {
        this.count = count;
        const teaser = t(`Games.${this.session.gameType}.Teaser`);
        for (const slot of this.slots) {
          slot.bannerTitle.textContent = count;
          slot.bannerDetail.textContent = t("Overlay.GetReady");
          slot.bannerHint.textContent = teaser;
          this.triggerPop(slot.bannerTitle);
        }
        this.sound.play("Countdown");
      }
      return;
    }

    if (!this.started) {
      this.started = true;
      this.goUntil = performance.now() + 340;
      for (const slot of this.slots) {
        slot.bannerTitle.textContent = t("Overlay.Go");
        slot.bannerDetail.textContent = "";
        slot.bannerHint.textContent = "";
        slot.banner.classList.add("ct-go-flash");
        this.triggerPop(slot.bannerTitle);
      }
      this.sound.play("Start");
      this.sound.startRound();
      if (this.activeSlot) this.activeSlot.game.start(this.pointer);
    }

    if (performance.now() >= this.goUntil) {
      for (const slot of this.slots) {
        if (!slot.result && !slot.banner.hidden) {
          slot.banner.hidden = true;
          slot.banner.classList.remove("ct-go-flash");
        }
      }
    }

    this.time = Math.max(this.time, clamp(-remaining / 1000, 0, this.session.durationSec));
    const cues = this.primarySlot.game.cues;
    while (this.cueIndex < cues.length && cues[this.cueIndex].time <= this.time) {
      const {time, sound} = cues[this.cueIndex++];
      if (this.time - time < 0.23) {
        this.sound.play(sound);
        if (sound === "BeamFire" && !this.reducedMotion) {
          for (const slot of this.slots) {
            if (!slot.result) slot.shake = Math.max(slot.shake, 4);
          }
        }
      }
    }

    const active = this.activeSlot;
    if (!active || active.result) return;
    const input = {
      x: Number(this.held(RIGHT)) - Number(this.held(LEFT)),
      y: Number(this.held(DOWN)) - Number(this.held(UP)),
      jump: this.held(JUMP),
      dir: this.shieldDir
    };
    while (this.simulated < this.time && !active.game.result) {
      const dt = Math.min(STEP, this.time - this.simulated);
      this.simulated += dt;
      active.game.step(dt, this.simulated, input, this.pointer);
    }
    this.finishIfNeeded();
  }

  finishIfNeeded() {
    const active = this.activeSlot;
    if (active?.game.result && !active.result) {
      this.publishResult(active.userId, active.game.result);
    }
  }

  handleSlotEvent(slot, event, timingStrike) {
    if (event !== "finish") {
      const {x, y, vx, vy} = slot.game.state;
      this.reactSlot(slot, event, {x, y, vx, vy});
    }
    this.sendState(slot, event, timingStrike);
  }

  spawnParticles(slot, x, y, color, count, speed, ring = false, baseAngle = 0, spread = Math.PI * 2) {
    if (this.reducedMotion) return;
    if (ring) {
      slot.particles.push({kind: "ring", x, y, color, radius: 6, maxRadius: 42, life: 0, maxLife: 0.34});
    }
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * spread;
      const spd = speed * (0.45 + Math.random() * 0.75);
      slot.particles.push({
        kind: "shard",
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: 2.2 + Math.random() * 2.8,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10,
        color,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.24
      });
    }
    if (slot.particles.length > 60) {
      slot.particles.splice(0, slot.particles.length - 60);
    }
  }

  reactSlot(slot, event, pos) {
    const soundScale = slot.active ? 1 : (this.activeSlot ? 0.5 : 1);
    if (event === "hit") {
      slot.flash = {event, at: performance.now()};
      slot.shake = Math.max(slot.shake, 9);
      this.spawnParticles(slot, pos.x, pos.y, "#fb7185", 14, 155, true);
      this.sound.play("Hit", soundScale);
    } else if (event === "timingHit") {
      slot.flash = {event, at: performance.now()};
      slot.shake = Math.max(slot.shake, 3);
      this.spawnParticles(slot, pos.x, pos.y, "#fcd57c", 12, 125, true);
      this.sound.play("TimingHit", soundScale);
    } else if (event === "jump") {
      this.spawnParticles(slot, pos.x, pos.y + 8, "#c084fc", 6, 78, false, Math.PI / 2, 1.1);
      this.sound.play("Jump", soundScale * 0.85);
    } else if (event === "block") {
      slot.shake = Math.max(slot.shake, 2.5);
      const bx = pos.x + (pos.vx ?? slot.view.vx ?? 0) * 28;
      const by = pos.y + (pos.vy ?? slot.view.vy ?? -1) * 28;
      this.spawnParticles(slot, bx, by, "#67e8f9", 9, 110, true);
      this.sound.play("ShieldBlock", soundScale);
    }
  }

  sendState(slot, event, timingStrike) {
    const now = performance.now();
    if (!slot.active || (!event && now - slot.lastSend < SEND_INTERVAL)) return;
    slot.lastSend = now;
    const {x, y, vx, vy, moving, lives, progress, activeStarted, invulnerableUntil, tracking, attemptsMask, aimStruck, aimCracked} = slot.game.state;
    const payload = {
      seq: ++slot.sequence,
      t: clamp(this.simulated, 0, this.session.durationSec),
      x, y, vx, vy, moving, lives, progress, activeStarted, invulnerableUntil, tracking
    };
    if (attemptsMask !== undefined) payload.attemptsMask = attemptsMask;
    if (aimStruck !== undefined) Object.assign(payload, {aimStruck, aimCracked});
    if (timingStrike !== undefined) payload.timingStrike = timingStrike;
    if (event !== undefined) payload.event = event;
    this.publishState(slot.userId, payload);
  }

  receiveState(userId, state) {
    const slot = this.slotMap.get(userId);
    if (!slot || slot.active || slot.result || this.finished) return;
    slot.lastSnapshotAt = performance.now();
    slot.snapshots.push({...state, reacted: false});
    if (slot.snapshots.length > MAX_SNAPSHOTS) slot.snapshots.shift();
  }

  sampleSlotView(slot, dt) {
    if (slot.active) {
      slot.view = slot.game.state;
      if (this.session.gameType === "maze") slot.localTrail = slot.game.trail;
      return this.time;
    }

    if (!slot.snapshots.length) {
      slot.renderTime = clamp(this.time - 0.08, 0, this.session.durationSec);
      return slot.renderTime;
    }

    const latest = slot.snapshots.at(-1);
    if (!slot.result) {
      const staleSec = Math.max(0, (performance.now() - slot.lastSnapshotAt) / 1000);
      const stalled = staleSec > STALL_THRESHOLD_SEC;
      const liveTarget = Math.max(0, latest.t - 0.08);
      const maxClock = Math.min(this.session.durationSec, Math.max(this.time, latest.t));
      const targetTime = stalled
        ? clamp(Math.max(liveTarget, latest.t + staleSec - 0.08), 0, maxClock)
        : liveTarget;
      slot.renderTime += dt;
      const drift = targetTime - slot.renderTime;
      if (Math.abs(drift) > 0.25) slot.renderTime = targetTime;
      else slot.renderTime += drift * clamp(dt * 8, 0, 1);
      slot.renderTime = clamp(slot.renderTime, 0, stalled ? maxClock : latest.t);
    } else {
      slot.renderTime = latest.t;
    }

    for (const snap of slot.snapshots) {
      if (!snap.reacted && (slot.renderTime >= snap.t || slot.result)) {
        snap.reacted = true;
        if (this.session.gameType === "aim") slot.game.syncSpectatorTargets(snap, snap.t);
        if (this.session.gameType === "timing" && snap.timingStrike) {
          slot.game.showStrike(snap.timingStrike, snap.t);
        }
        if (snap.event) this.reactSlot(slot, snap.event, {x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy});
      }
    }

    let idx = -1;
    for (let i = slot.snapshots.length - 1; i >= 0; i--) {
      if (slot.snapshots[i].t <= slot.renderTime) {
        idx = i;
        break;
      }
    }

    let sampled;
    if (idx === -1) {
      sampled = slot.snapshots[0];
    } else if (idx === slot.snapshots.length - 1) {
      sampled = slot.snapshots[idx];
    } else {
      const s0 = slot.snapshots[idx];
      const s1 = slot.snapshots[idx + 1];
      const span = s1.t - s0.t;
      const alpha = span > 1e-4 ? clamp((slot.renderTime - s0.t) / span, 0, 1) : 1;
      let x = s0.x + (s1.x - s0.x) * alpha;
      let y = s0.y + (s1.y - s0.y) * alpha;
      if (this.session.gameType === "maze" && !slot.game.allows({x, y})) {
        const fallback = alpha < 0.5 ? s0 : s1;
        x = fallback.x;
        y = fallback.y;
      }
      sampled = {...s0, x, y};
    }

    slot.view = sampled;
    if (this.session.gameType === "maze") {
      const last = slot.localTrail.at(-1);
      if (!last || Math.hypot(sampled.x - last.x, sampled.y - last.y) > 2) {
        slot.localTrail = slot.localTrail.concat({x: sampled.x, y: sampled.y}).slice(-TRAIL_LENGTH);
      }
    }
    return slot.renderTime;
  }

  updateAndDrawParticles(slot, ctx, dt) {
    if (!slot.particles.length) return;
    const alive = [];
    ctx.save();
    for (const p of slot.particles) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      const alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      if (p.kind === "ring") {
        const radius = p.radius + (p.maxRadius - p.radius) * (1 - alpha);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5 * alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-dt * 4);
        p.vy *= Math.exp(-dt * 4);
        p.angle += p.spin * dt;
        crystal(ctx, p.x, p.y, p.size, p.size * 1.4, p.color, p.angle);
      }
      alive.push(p);
    }
    ctx.restore();
    slot.particles = alive;
  }

  backgroundTick() {
    if (this.closed) return;
    const now = performance.now();
    if (now - this.lastRaf < RAF_STALL_MS) return;
    const dt = clamp((now - (this.lastFrame ?? now)) / 1000, 0, 0.25);
    this.lastFrame = now;
    if (!this.finished) {
      this.advance(this.getNow());
      if (!this.closed && this.activeSlot && !this.activeSlot.result && this.started) {
        this.sendState(this.activeSlot);
      }
    }
    if (!this.closed && !document.hidden) {
      this.paint(now, dt);
    }
  }

  frame = now => {
    if (this.closed) return;
    const dt = clamp((now - (this.lastFrame ?? now)) / 1000, 0, 0.10);
    this.lastFrame = now;
    this.lastRaf = performance.now();
    if (!this.finished) {
      this.advance(this.getNow());
      if (this.activeSlot && !this.activeSlot.result && this.started) {
        this.sendState(this.activeSlot);
      }
    }
    const p0 = performance.now();
    this.paint(now, dt);
    const pMs = performance.now() - p0;
    if (!this.perfWindowStart) this.perfWindowStart = now;
    this.perfFrames++;
    this.perfPaintSum += pMs;
    if (pMs > this.perfPaintMax) this.perfPaintMax = pMs;
    const elapsed = now - this.perfWindowStart;
    if (elapsed >= 1000 && this.root?.dataset) {
      const fps = Math.round((this.perfFrames * 1000) / elapsed);
      const avg = (this.perfPaintSum / this.perfFrames).toFixed(2);
      const max = this.perfPaintMax.toFixed(2);
      this.root.dataset.ctPerf = `fps=${fps} avgPaint=${avg}ms maxPaint=${max}ms`;
      this.perfWindowStart = now;
      this.perfFrames = 0;
      this.perfPaintSum = 0;
      this.perfPaintMax = 0;
    }
    this.frameId = requestAnimationFrame(this.frame);
  };

  paint(now, dt = 0, final = false) {
    const {gameType, durationSec, difficulty} = this.session;
    for (const slot of this.slots) {
      const renderTime = this.sampleSlotView(slot, dt);
      const drawTime = slot.result ? slot.result.elapsedSec : renderTime;
      const ctx = slot.ctx;

      ctx.save();
      if (slot.shake > 0.2 && !this.reducedMotion) {
        ctx.fillStyle = "#0b0912";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        const sx = (Math.random() * 2 - 1) * slot.shake;
        const sy = (Math.random() * 2 - 1) * slot.shake;
        ctx.translate(sx, sy);
        slot.shake *= Math.exp(-dt * 18);
      } else {
        slot.shake = 0;
      }

      ctx.drawImage(slot.backdrop, 0, 0, WIDTH, HEIGHT);
      slot.game.draw(ctx, drawTime, slot.view, this.labels, slot.localTrail);
      this.updateAndDrawParticles(slot, ctx, dt);

      if (slot.flash && now - slot.flash.at < 310) {
        const hit = slot.flash.event === "hit";
        const alpha = (1 - (now - slot.flash.at) / 310) ** 2;
        ctx.fillStyle = hit ? "#fb7185" : "#e9a8ff";
        ctx.globalAlpha = alpha * (hit ? 0.23 : 0.16);
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
      ctx.restore();

      const remainingFrac = clamp(1 - drawTime / durationSec, 0, 1);
      const timeScale = remainingFrac.toFixed(3);
      if (timeScale !== slot.lastTimeScale) {
        slot.lastTimeScale = timeScale;
        slot.timeFill.style.transform = `scaleX(${timeScale})`;
      }
      const timeLow = durationSec - drawTime <= 3;
      if (timeLow !== slot.timeLow) {
        slot.timeLow = timeLow;
        slot.timeFill.classList.toggle("ct-timebar-low", timeLow);
      }

      const lives = slot.result ? slot.result.livesLeft : slot.view.lives;
      if (lives !== slot.displayedLives) {
        const prev = slot.displayedLives;
        slot.displayedLives = lives;
        slot.health.setAttribute("aria-label", t("Overlay.Lives", {lives, max: slot.pips.length}));
        slot.pips.forEach((pip, index) => {
          const spent = index >= lives;
          if (spent && index < prev && !this.reducedMotion) {
            pip.classList.remove("ct-pip-break");
            void pip.offsetWidth;
            pip.classList.add("ct-pip-break");
          }
          pip.classList.toggle("ct-spent", spent);
        });
      }

      let statusKey = gameType;
      if (gameType === "maze") {
        statusKey = !slot.view.activeStarted ? `maze:0:${slot.active}` : !slot.view.tracking ? `maze:1:${slot.active}` : `maze:2:${difficulty}`;
      } else if (gameType === "timing" || gameType === "aim" || gameType === "sigil" || gameType === "shield") {
        statusKey = `${gameType}:${slot.view.progress}`;
      } else if (gameType === "resonance") {
        statusKey = `resonance:${difficulty}`;
      }
      if (statusKey !== slot.statusKey) {
        slot.statusKey = statusKey;
        let status = t(`Games.${gameType}.Help`);
        if (gameType === "maze") {
          if (!slot.view.activeStarted) status = t(slot.active ? "Overlay.GrabStart" : "Overlay.WatchingStart");
          else if (!slot.view.tracking) status = t(slot.active ? "Overlay.Regrab" : "Overlay.WatchingRegrab");
          else if (difficulty === "hard" || difficulty === "insane") status = t("Overlay.MazeGates");
        } else if (gameType === "timing") {
          status = t("Overlay.TimingProgress", {
            hits: slot.view.progress, total: slot.game.totalZones, required: slot.game.rules.required
          });
        } else if (gameType === "aim") {
          status = t("Overlay.AimProgress", {
            hits: slot.view.progress, total: slot.game.rules.count, required: slot.game.rules.required
          });
        } else if (gameType === "sigil") {
          status = t("Overlay.SigilProgress", {
            hits: slot.view.progress, total: slot.game.rules.length
          });
        } else if (gameType === "shield") {
          status = t("Overlay.ShieldProgress", {hits: slot.view.progress});
        } else if (gameType === "resonance" && (difficulty === "hard" || difficulty === "insane")) {
          status = t("Overlay.ResonanceHard");
        }
        if (slot.status.textContent !== status) slot.status.textContent = status;
      }
    }

    const displayTime = final && this.slots.every(s => s.result)
      ? Math.max(...this.slots.map(s => s.result.elapsedSec))
      : this.time;
    const remainingSec = Math.max(0, durationSec - displayTime);
    const tenth = Math.round(remainingSec * 10);
    if (tenth !== this.clockTenth) {
      this.clockTenth = tenth;
      const clock = t("Overlay.Timer", {seconds: this.number.format(tenth / 10)});
      if (this.clock.textContent !== clock) this.clock.textContent = clock;
    }
    const clockLow = remainingSec <= 3;
    if (clockLow !== this.clockLow) {
      this.clockLow = clockLow;
      this.clock.classList.toggle("ct-clock-low", clockLow);
    }
  }

  showSlotResult(userId, result) {
    const slot = this.slotMap.get(userId);
    if (!slot) return;
    if (slot.result && !(slot.result.fromWatchdog && !result.fromWatchdog)) return;
    slot.result = result;
    if (slot.active) {
      this.keys.clear();
      this.shieldDir = -1;
    }

    slot.card.classList.remove("ct-slot-win", "ct-slot-loss");
    slot.card.classList.add(result.success ? "ct-slot-win" : "ct-slot-loss");
    slot.banner.classList.remove("ct-go-flash");
    slot.banner.hidden = false;
    slot.bannerTitle.textContent = t(result.success ? "Result.Win" : "Result.Lose");
    slot.bannerDetail.textContent = t(`Result.Reasons.${result.reason}`);
    slot.bannerHint.textContent = "";

    const pos = {x: slot.view.x, y: slot.view.y};
    if (result.success) {
      this.spawnParticles(slot, pos.x, pos.y, "#8ff3cb", 22, 180, true);
    } else {
      slot.shake = Math.max(slot.shake, 11);
      this.spawnParticles(slot, pos.x, pos.y, "#fb7185", 20, 175, true);
    }

    const allDone = this.slots.every(entry => Boolean(entry.result));
    if (this.slots.length === 1 || slot.active || allDone) {
      const scale = (slot.active || this.slots.length === 1) ? 1 : 0.65;
      this.sound.play(result.success ? "Win" : "Lose", scale);
    }
    this.paint(performance.now(), 0, allDone);
  }

  finishAll(holdMs) {
    if (this.finished) return;
    this.finished = true;
    this.keys.clear();
    this.shieldDir = -1;
    this.sound.endRound();
    this.paint(performance.now(), 0, true);
    this.holdId = setTimeout(() => {
      this.root.classList.add("ct-closing");
      this.closeId = setTimeout(() => this.close(), CLOSE_MS);
    }, Math.max(0, holdMs));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pausedCanvasTicker) {
      this.pausedCanvasTicker = false;
      try {
        if (typeof canvas !== "undefined" && canvas?.app?.ticker && !canvas.app.ticker.started) {
          canvas.app.ticker.start();
        }
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not resume canvas ticker`, error);
      }
    }
    this.listeners.abort();
    this.keys.clear();
    this.shieldDir = -1;
    cancelAnimationFrame(this.frameId);
    clearInterval(this.bgTimer);
    this.bgTimer = null;
    clearTimeout(this.holdId);
    clearTimeout(this.closeId);
    this.sound.close();
    this.root?.close();
    this.root?.remove();
    this.onClosed();
  }
}
