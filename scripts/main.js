import {HEIGHT, WIDTH, clamp} from "./games/base.js";
import {DIFFICULTIES, GAMES} from "./games/index.js";
import {GmLauncher} from "./gm-launcher.js";
import {TrialOverlay} from "./overlay.js";
import {MODULE_ID, SOCKET, element, serverTime, setting, t} from "./shared.js";
import {preloadSounds, registerSoundSettings} from "./sound-manager.js";

const START_LEAD_MS = 180;
const WATCHDOG_GRACE_MS = 2500;
const OBSERVER_GRACE_MS = 2200;
const WIN_REASONS = ["survived", "timing", "maze", "aim", "sigil"];
const LOSS_REASONS = ["lives", "missed", "timeout", "disconnected"];
const STATE_EVENTS = ["hit", "timingHit", "jump", "block", "finish"];

let current = null;
let launcher = null;
let ready = false;
let warnedMissingSender = false;

function registerSettings() {
  const settings = {
    postToChat: {type: Boolean, default: true},
    endHoldMs: {type: Number, default: 1600, range: {min: 0, max: 5000, step: 100}},
    countdownSec: {type: Number, default: 2, range: {min: 1, max: 5, step: 1}}
  };
  for (const [key, config] of Object.entries(settings)) {
    game.settings.register(MODULE_ID, key, {
      name: `CrystalTrials.Settings.${key}.Name`, hint: `CrystalTrials.Settings.${key}.Hint`,
      scope: "world", config: true, ...config
    });
  }
  registerSoundSettings(() => {
    current?.overlay.sound.refresh();
    current?.overlay.updateMuteButton?.();
  });
}

function assertReadyGM() {
  if (!ready || !game.socket?.connected) throw new Error(t("Errors.NotConnected"));
  if (!game.user?.isGM) throw new Error(t("Errors.OnlyGM"));
}

function send(type, data) {
  if (game.socket?.connected) game.socket.emit(SOCKET, {type, ...data});
}

function roundNow(round) {
  return serverTime() + (round?.timeBias ?? 0);
}

function userColorCss(user) {
  if (!user) return "#e879f9";
  if (typeof user.color === "string" && user.color) return user.color;
  if (user.color?.css) return user.color.css;
  return user.isGM ? "#c084fc" : "#e879f9";
}

async function openLauncher() {
  assertReadyGM();
  launcher ??= new GmLauncher(api, () => current?.session);
  return launcher.open();
}

function start({userId, secondUserId, userIds, gameType = "random", difficulty = "medium", lives = 3, title = "", localOnly = false} = {}) {
  assertReadyGM();
  if (current) throw new Error(t("Errors.AlreadyRunning"));

  const rawIds = (Array.isArray(userIds) ? userIds : [userId, secondUserId]).filter(Boolean);
  if (!rawIds.length || rawIds.length > 2) throw new Error(t("Errors.PlayerUnavailable"));
  if (new Set(rawIds).size !== rawIds.length) throw new Error(t("Errors.SamePlayers"));

  const users = rawIds.map(id => game.users.get(id));
  if (users.some(user => !user?.active || (user.isGM && user.id !== game.user.id))) {
    throw new Error(t("Errors.PlayerUnavailable"));
  }

  localOnly = Boolean(localOnly);
  if (localOnly && (users.length !== 1 || users[0].id !== game.user.id)) {
    throw new Error(t("Errors.LocalOnlyRequiresGM"));
  }

  const level = DIFFICULTIES.indexOf(difficulty);
  lives = Number(lives);
  if (level < 0 || !Number.isInteger(lives) || lives < 1 || lives > 5) throw new Error(t("Errors.InvalidOptions"));

  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const types = Object.keys(GAMES);
  if (gameType === "random") gameType = types[seed % types.length];
  if (!Object.hasOwn(GAMES, gameType)) throw new Error(t("Errors.InvalidMode"));

  const countdownSec = clamp(Math.round(setting("countdownSec")), 1, 5);
  const now = serverTime();
  const session = {
    sessionId: foundry.utils.randomID(),
    targets: users.map(user => ({
      userId: user.id,
      name: user.name,
      color: userColorCss(user)
    })),
    gameType,
    difficulty,
    lives,
    durationSec: GAMES[gameType].duration[level],
    seed,
    startAtTimestamp: now + countdownSec * 1000 + START_LEAD_MS,
    sentAt: now,
    customTitle: String(title ?? "").trim().slice(0, 100),
    countdownSec,
    endHoldMs: clamp(setting("endHoldMs"), 0, 5000),
    localOnly
  };

  openRound(session);
  if (!session.localOnly) send("START_GAME", session);
  return session.sessionId;
}

function abort() {
  assertReadyGM();
  if (!current) return false;
  const session = current.session;
  if (!session.localOnly && game.socket?.connected) {
    send("ABORT_GAME", {sessionId: session.sessionId});
  }
  current.overlay.close();
  return true;
}

const api = Object.freeze({openLauncher, start, abort});

function openRound(session, timeBias = 0) {
  const slots = new Map(session.targets.map(target => [target.userId, {target, snapshot: null, result: null}]));
  const round = {
    session,
    timeBias,
    deadline: session.startAtTimestamp + session.durationSec * 1000,
    slots,
    allFinished: false,
    watchdog: null
  };
  const overlay = round.overlay = new TrialOverlay(session, {
    activeUserId: session.targets.some(target => target.userId === game.user.id) ? game.user.id : null,
    getNow: () => roundNow(round),
    isGM: game.user.isGM,
    publishState: (userId, snapshot) => {
      if (current !== round || round.allFinished) return;
      const slot = round.slots.get(userId);
      if (!slot || slot.result) return;
      slot.snapshot = snapshot;
      if (!session.localOnly) send("PLAYER_STATE", {sessionId: session.sessionId, userId, ...snapshot});
    },
    publishResult: (userId, result) => broadcastSlotResult(round, userId, result),
    onAbort: () => abort(),
    onClosed: () => {
      clearTimeout(round.watchdog);
      if (current === round) current = null;
      launcher?.refreshSession();
    }
  });
  current = round;
  try {
    overlay.open();
    scheduleWatchdog(round);
    launcher?.refreshSession();
  } catch (error) {
    overlay.close();
    throw error;
  }
}

function scheduleWatchdog(round, retryAt = round.deadline + WATCHDOG_GRACE_MS) {
  clearTimeout(round.watchdog);
  round.watchdog = setTimeout(() => checkRound(round), Math.max(0, Math.ceil(retryAt - roundNow(round))));
}

function checkRound(round) {
  if (!round || current !== round || round.allFinished) return;
  const now = roundNow(round);
  const expiredAt = round.deadline + WATCHDOG_GRACE_MS;
  const unfinished = [...round.slots.values()].filter(slot => !slot.result);
  if (!unfinished.length) return;

  const isAuthoritativeGM = game.user.id === game.users.activeGM?.id && (round.session.localOnly || game.socket?.connected);
  for (const slot of unfinished) {
    const offline = !game.users.get(slot.target.userId)?.active;
    const reason = offline ? "disconnected" : "timeout";
    if ((offline || now >= expiredAt) && isAuthoritativeGM) {
      broadcastSlotResult(round, slot.target.userId, fallbackResult(round, slot, reason, now), true);
    } else if (now >= expiredAt + OBSERVER_GRACE_MS) {
      settleSlot(round, slot.target.userId, fallbackResult(round, slot, reason, now), now, false);
    }
  }

  if (!round.allFinished) {
    scheduleWatchdog(round, now < expiredAt ? expiredAt : Math.min(now + 400, expiredAt + OBSERVER_GRACE_MS));
  }
}

function fallbackResult(round, slot, reason, now) {
  const {lives: maxLives, durationSec, startAtTimestamp} = round.session;
  const livesLeft = slot.snapshot?.lives ?? maxLives;
  return {
    success: false,
    reason,
    maxLives,
    livesLeft,
    hitsTaken: maxLives - livesLeft,
    elapsedSec: clamp((now - startAtTimestamp) / 1000, 0, durationSec)
  };
}

function broadcastSlotResult(round, userId, result, fromWatchdog = false) {
  if (current !== round) return;
  const slot = round.slots.get(userId);
  if (!slot || (slot.result && !slot.result.fromWatchdog)) return;
  const endedAt = roundNow(round);
  if (!round.session.localOnly) {
    send("SLOT_END", {sessionId: round.session.sessionId, userId, ...result, endedAt});
  }
  settleSlot(round, userId, {...result, fromWatchdog}, endedAt);
}

function settleSlot(round, userId, result, endedAt, allowChat = true) {
  const slot = round.slots.get(userId);
  if (!slot) return;
  slot.result = result;
  round.overlay.showSlotResult(userId, result);

  const allDone = [...round.slots.values()].every(entry => Boolean(entry.result));
  if (!allDone || round.allFinished) return;

  round.allFinished = true;
  clearTimeout(round.watchdog);
  const hold = round.session.endHoldMs;
  round.overlay.finishAll(clamp(endedAt + hold - roundNow(round), 0, hold));
  if (allowChat && !round.session.localOnly && game.user.id === game.users.activeGM?.id && setting("postToChat")) {
    void postChat(round).catch(error => console.error(`${MODULE_ID} | Could not post result`, error));
  }
}

async function postChat(round) {
  const {session, slots} = round;
  if (game.messages.has(session.sessionId)) return;
  const formatter = new Intl.NumberFormat(game.i18n.lang, {maximumFractionDigits: 1});
  const mode = t(`Games.${session.gameType}.Name`);
  const diffLabel = t(`Difficulty.${session.difficulty}`);
  const results = [...slots.values()];
  const wins = results.filter(entry => entry.result.success).length;
  const stateClass = wins === results.length ? "ct-chat-win" : wins === 0 ? "ct-chat-loss" : "ct-chat-mixed";

  const card = element("div", `ct-chat-card ${stateClass}`);
  const header = element("div", "ct-chat-head");
  const titleText = session.customTitle ? `${session.customTitle} · ${mode}` : mode;
  header.append(
    element("strong", "ct-chat-title", titleText),
    element("span", `ct-chat-diff ct-diff-${session.difficulty}`, diffLabel)
  );
  card.append(header);

  const rows = element("div", "ct-chat-rows");
  for (const {target, result} of results) {
    const row = element("div", `ct-chat-row ${result.success ? "ct-row-win" : "ct-row-loss"}`);
    const top = element("div", "ct-chat-row-top");
    const status = t(result.success ? "Result.Success" : "Result.Failure");
    top.append(
      element("span", "ct-chat-player", target.name),
      element("span", "ct-chat-outcome", status)
    );
    const seconds = formatter.format(result.elapsedSec);
    const reasonText = t(`Result.Reasons.${result.reason}`);
    const detail = element("div", "ct-chat-row-detail", `${reasonText} · ${t("Chat.Stats", {hits: result.hitsTaken, seconds})}`);
    row.append(top, detail);
    rows.append(row);
  }
  card.append(rows);

  await CONFIG.ChatMessage.documentClass.create({
    _id: session.sessionId,
    speaker: {alias: t("Title")},
    content: card.outerHTML
  }, {keepId: true});
}

function isBetween(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isPosition(point) {
  return point && isBetween(point.x, 0, WIDTH) && isBetween(point.y, 0, HEIGHT);
}

function computeTimeBias(data) {
  if (!Number.isFinite(data.sentAt)) return 0;
  const drift = data.sentAt - serverTime();
  if (Math.abs(drift) > 1500 && Math.abs(drift) < 120000) {
    void game.time.sync?.();
    return drift;
  }
  return 0;
}

function isValidSession(data, sender, timeBias) {
  if (!sender?.isGM || data.localOnly || !Object.hasOwn(GAMES, data.gameType)) return false;
  if (!Array.isArray(data.targets) || data.targets.length < 1 || data.targets.length > 2) return false;

  const seen = new Set();
  for (const target of data.targets) {
    if (!target || typeof target.userId !== "string" || seen.has(target.userId)) return false;
    seen.add(target.userId);
    const user = game.users.get(target.userId);
    if (!user || (user.isGM && user.id !== sender.id)) return false;
    if (typeof target.name !== "string" || typeof target.color !== "string" || target.color.length > 32) return false;
  }

  const level = DIFFICULTIES.indexOf(data.difficulty);
  return typeof data.customTitle === "string"
    && data.customTitle.length <= 100
    && Number.isInteger(data.lives) && isBetween(data.lives, 1, 5)
    && Number.isInteger(data.seed) && isBetween(data.seed, 0, 0xFFFFFFFF)
    && level >= 0 && data.durationSec === GAMES[data.gameType].duration[level]
    && Number.isInteger(data.countdownSec) && isBetween(data.countdownSec, 1, 5)
    && isBetween(data.endHoldMs, 0, 5000)
    && isBetween(data.startAtTimestamp - (serverTime() + timeBias), -4500, 12000);
}

function receiveStart(data, sender) {
  const timeBias = computeTimeBias(data);
  if (!isValidSession(data, sender, timeBias)) return;
  if (current?.session.sessionId === data.sessionId) return;
  if (current && !current.allFinished) {
    const previous = current.session;
    const currentStarted = roundNow(current) >= previous.startAtTimestamp;
    if (currentStarted) return;
    if (data.startAtTimestamp > previous.startAtTimestamp
      || (data.startAtTimestamp === previous.startAtTimestamp && data.sessionId > previous.sessionId)) {
      return;
    }
  }
  current?.overlay.close();
  openRound(data, timeBias);
}

function receiveState(round, data, senderId) {
  const {userId, seq, t: simTime, x, y, vx, vy, moving, lives, progress, activeStarted, invulnerableUntil, tracking, event} = data;
  const slot = round.slots.get(userId);
  if (!slot || senderId !== userId || slot.result || userId === game.user.id) return;

  const {gameType, difficulty} = round.session;
  const maxProgress = GAMES[gameType].maxProgress[DIFFICULTIES.indexOf(difficulty)];
  if (!Number.isSafeInteger(seq) || seq <= (slot.snapshot?.seq ?? 0)
    || !isBetween(simTime, 0, round.session.durationSec)
    || !isPosition(data) || !Number.isFinite(vx) || !Number.isFinite(vy) || typeof moving !== "boolean"
    || !Number.isInteger(lives) || !isBetween(lives, 0, round.session.lives)
    || !Number.isInteger(progress) || !isBetween(progress, 0, maxProgress)
    || typeof activeStarted !== "boolean" || !isBetween(invulnerableUntil, 0, round.session.durationSec + 0.75)
    || (event !== undefined && !STATE_EVENTS.includes(event))) return;
  if (gameType === "maze" && typeof tracking !== "boolean") return;

  slot.snapshot = {seq, t: simTime, x, y, vx, vy, moving, lives, progress, activeStarted, invulnerableUntil, tracking, event};
  round.overlay.receiveState(userId, slot.snapshot);
}

function receiveSlotEnd(round, data, sender) {
  if (!sender) return;
  const {userId, success, reason, hitsTaken, livesLeft, maxLives, elapsedSec, endedAt} = data;
  const slot = round.slots.get(userId);
  if (!slot) return;

  const isTarget = sender.id === userId;
  const isGmFallback = sender.isGM && !success && ["timeout", "disconnected"].includes(reason);
  if (!isTarget && !isGmFallback) return;

  if (slot.result) {
    if (!(slot.result.fromWatchdog && isTarget && !round.allFinished)) return;
  }

  if (typeof success !== "boolean" || !(success ? WIN_REASONS : LOSS_REASONS).includes(reason)
    || maxLives !== round.session.lives || !Number.isInteger(livesLeft) || !isBetween(livesLeft, 0, maxLives)
    || hitsTaken !== maxLives - livesLeft || !isBetween(elapsedSec, 0, round.session.durationSec)
    || !isBetween(endedAt, round.session.startAtTimestamp - 10000, roundNow(round) + 10000)) return;

  settleSlot(round, userId, {success, reason, hitsTaken, livesLeft, maxLives, elapsedSec, fromWatchdog: false}, endedAt);
}

function receive(data, senderId) {
  if (!data || typeof data.sessionId !== "string" || !/^[A-Za-z0-9]{16}$/.test(data.sessionId)) return;
  if (!senderId) {
    if (!warnedMissingSender) {
      warnedMissingSender = true;
      console.warn(`${MODULE_ID} | Socket message arrived without senderId`);
    }
    return;
  }
  const sender = game.users.get(senderId);
  if (data.type === "START_GAME") {
    try {
      receiveStart(data, sender);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not open trial`, error);
    }
    return;
  }
  const round = current;
  if (round?.session.sessionId !== data.sessionId) return;
  if (data.type === "PLAYER_STATE") receiveState(round, data, senderId);
  else if (data.type === "SLOT_END") receiveSlotEnd(round, data, sender);
  else if (data.type === "ABORT_GAME" && sender?.isGM) round.overlay.close();
}

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = api;
});

Hooks.on("getSceneControlButtons", controls => {
  const tools = controls?.tokens?.tools;
  if (!game.user?.isGM || !tools || typeof tools !== "object" || Array.isArray(tools)) return;
  tools.crystalTrials = {
    name: "crystalTrials",
    title: "CrystalTrials.Title",
    icon: "fa-solid fa-gem",
    order: Math.max(0, ...Object.values(tools).map(tool => tool.order ?? 0)) + 1,
    button: true,
    visible: true,
    onChange: () => { void openLauncher().catch(error => ui.notifications.warn(error.message)); }
  };
});

Hooks.once("ready", () => {
  ready = true;
  void preloadSounds();
  game.socket.on(SOCKET, receive);
  game.socket.on("disconnect", () => current?.overlay.close());
  Hooks.on("controlToken", () => launcher?.refreshPlayers(true));
  Hooks.on("userConnected", () => {
    launcher?.refreshPlayers();
    checkRound(current);
  });
});
