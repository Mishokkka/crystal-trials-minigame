import {MODULE_ID, setting} from "./shared.js";

export const SOUND_FILES = {
  Open: "open.ogg",
  Countdown: "countdown.ogg",
  Start: "start.ogg",
  Hit: "hit.ogg",
  Telegraph: "telegraph.ogg",
  BeamFire: "beam-fire.ogg",
  TimingHit: "timing-hit.ogg",
  Jump: "jump.ogg",
  ShardWave: "shard-wave.ogg",
  GateWarn: "gate-warn.ogg",
  ShieldBlock: "shield-block.ogg",
  Win: "win.ogg",
  Lose: "lose.ogg",
  Close: "close.ogg",
  Bgm: ""
};

const LEGACY_WAV_MAP = new Map(
  Object.values(SOUND_FILES)
    .filter(Boolean)
    .map(file => {
      const ogg = `modules/${MODULE_ID}/assets/sounds/${file}`;
      return [ogg.replace(/\.ogg$/, ".wav"), ogg];
    })
);

const UNTRACKED = new Set(["Close", "Win", "Lose"]);
const UNTHROTTLED = new Set(["Close", "Win", "Lose", "Open"]);
const MAX_BUFFER_CACHE = 32;
const DUPLICATE_COOLDOWN_MS = 28;

const decodedBuffers = new Map();
const loadingBuffers = new Map();
const failedBuffers = new Set();
const interfaceGains = new Map();

export function registerSoundSettings(onChange) {
  game.settings.register(MODULE_ID, "masterVolume", {
    name: "CrystalTrials.Settings.masterVolume.Name", hint: "CrystalTrials.Settings.masterVolume.Hint",
    scope: "world", config: true, type: Number, default: 0.7, range: {min: 0, max: 1, step: 0.05}, onChange
  });
  game.settings.register(MODULE_ID, "muteLocal", {
    name: "CrystalTrials.Settings.muteLocal.Name", hint: "CrystalTrials.Settings.muteLocal.Hint",
    scope: "client", config: true, type: Boolean, default: false, onChange
  });
  for (const [key, file] of Object.entries(SOUND_FILES)) {
    game.settings.register(MODULE_ID, `sound${key}`, {
      name: `CrystalTrials.Sounds.${key}`, hint: "CrystalTrials.Settings.SoundHint",
      scope: "world", config: true, type: String, filePicker: "audio",
      default: file ? `modules/${MODULE_ID}/assets/sounds/${file}` : "",
      onChange: key === "Bgm" ? onChange : () => {
        failedBuffers.clear();
        void preloadSounds();
      }
    });
  }
}

function soundSource(key) {
  const raw = setting(`sound${key}`)?.trim() ?? "";
  return LEGACY_WAV_MAP.get(raw) ?? raw;
}

function volume() {
  return setting("muteLocal") ? 0 : setting("masterVolume");
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value));
}

function audioContext() {
  const iface = game.audio?.interface;
  const ctx = (iface && typeof iface.createBufferSource === "function") ? iface : game.audio?.context;
  return ctx && ctx.state !== "closed" ? ctx : null;
}

function resolveSrc(src) {
  try {
    return foundry?.utils?.getRoute?.(src) ?? src;
  } catch {
    return src;
  }
}

function interfaceVolume() {
  try {
    const value = game.settings.get("core", "globalInterfaceVolume");
    return Number.isFinite(value) ? clampVolume(value) : 1;
  } catch {
    return 1;
  }
}

function getInterfaceOutput(ctx) {
  let node = interfaceGains.get(ctx);
  if (!node && typeof ctx?.createGain === "function") {
    node = ctx.createGain();
    node.gain.value = interfaceVolume();
    node.connect(ctx.destination);
    interfaceGains.set(ctx, node);
  }
  return node ?? ctx.destination;
}

export function syncInterfaceVolume(volumeArg) {
  const level = Number.isFinite(volumeArg) ? clampVolume(volumeArg) : interfaceVolume();
  for (const [ctx, node] of interfaceGains) {
    if (ctx.state === "closed") {
      interfaceGains.delete(ctx);
      continue;
    }
    node.gain.value = level;
  }
}

async function ensureDecoded(src) {
  if (!src || failedBuffers.has(src)) return null;
  const cached = decodedBuffers.get(src);
  if (cached) return cached;
  const inflight = loadingBuffers.get(src);
  if (inflight) return inflight;
  const ctx = audioContext();
  if (!ctx?.decodeAudioData || typeof fetch !== "function") return null;

  const task = (async () => {
    try {
      const response = await fetch(resolveSrc(src));
      if (!response.ok) {
        failedBuffers.add(src);
        return null;
      }
      const bytes = await response.arrayBuffer();
      const activeCtx = audioContext();
      if (!activeCtx?.decodeAudioData) return null;
      const decoded = await activeCtx.decodeAudioData(bytes);
      if (decodedBuffers.size >= MAX_BUFFER_CACHE) {
        const oldest = decodedBuffers.keys().next().value;
        if (oldest !== undefined) decodedBuffers.delete(oldest);
      }
      decodedBuffers.set(src, decoded);
      return decoded;
    } catch {
      failedBuffers.add(src);
      return null;
    } finally {
      loadingBuffers.delete(src);
    }
  })();

  loadingBuffers.set(src, task);
  return task;
}

export async function preloadSounds() {
  if (setting("muteLocal")) return;
  try {
    if (game.audio?.locked && game.audio?.unlock) {
      await game.audio.unlock;
    }
    const sources = Object.keys(SOUND_FILES)
      .filter(key => key !== "Bgm")
      .map(key => soundSource(key))
      .filter(Boolean);
    await Promise.all(sources.map(src => ensureDecoded(src)));
  } catch {
    // Fall back silently to on-demand AudioHelper playback.
  }
}

async function playAudio(src, level, loop = false) {
  try {
    return await foundry.audio.AudioHelper.play({src, volume: level, autoplay: true, loop}, false);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not play ${src}`, error);
    return null;
  }
}

function stopAudio(sound) {
  if (!sound?.stop) return;
  void Promise.resolve(sound.stop()).catch(error => console.warn(`${MODULE_ID} | Could not stop audio`, error));
}

export class SoundManager {
  effects = new Set();
  lastPlayed = new Map();
  bgm = null;
  roundActive = false;

  preload() {
    return preloadSounds();
  }

  play(key, scale = 1) {
    const src = soundSource(key);
    const level = clampVolume(volume() * scale);
    // A browser that has not received a user gesture must not queue a round's worth of cues.
    if (!src || !level || game.audio.locked) return;

    const now = performance.now();
    if (!UNTHROTTLED.has(key)) {
      const prev = this.lastPlayed.get(key) ?? -Infinity;
      if (now - prev < DUPLICATE_COOLDOWN_MS) return;
    }
    this.lastPlayed.set(key, now);

    const ctx = audioContext();
    const buffer = decodedBuffers.get(src);
    if (ctx && ctx.state === "running" && buffer) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = clampVolume(level);
        const dest = getInterfaceOutput(ctx);
        source.connect(gain);
        gain.connect(dest);
        if (!UNTRACKED.has(key)) {
          const effect = {source, gain, scale};
          this.effects.add(effect);
          source.onended = () => {
            this.effects.delete(effect);
            try { gain.disconnect(); } catch {}
          };
        } else {
          source.onended = () => {
            try { gain.disconnect(); } catch {}
          };
        }
        source.start(0);
        return;
      } catch {
        // Fall through to Foundry AudioHelper playback on Web Audio node errors.
      }
    }

    if (ctx && !buffer) void ensureDecoded(src);

    if (UNTRACKED.has(key)) {
      void playAudio(src, level);
      return;
    }
    const effect = {sound: null, scale};
    this.effects.add(effect);
    void playAudio(src, level).then(sound => {
      if (!sound || !this.effects.has(effect)) {
        stopAudio(sound);
        this.effects.delete(effect);
        return;
      }
      effect.sound = sound;
      const cleanup = () => this.effects.delete(effect);
      sound.addEventListener?.("end", cleanup, {once: true});
      sound.addEventListener?.("stop", cleanup, {once: true});
    });
  }

  startRound() {
    this.roundActive = true;
    this.refresh();
  }

  endRound() {
    this.roundActive = false;
    this.stopBgm();
  }

  close() {
    this.endRound();
    this.stopEffects();
    this.play("Close");
  }

  stopEffects() {
    for (const effect of this.effects) {
      if (effect.source) {
        try { effect.source.onended = null; } catch {}
        try { effect.source.stop(); } catch {}
        try { effect.gain?.disconnect(); } catch {}
      } else {
        stopAudio(effect.sound);
      }
    }
    this.effects.clear();
  }

  stopBgm() {
    const previous = this.bgm;
    this.bgm = null;
    stopAudio(previous?.sound);
  }

  refresh() {
    const base = volume();
    if (!base) {
      this.stopEffects();
    } else {
      void preloadSounds();
      syncInterfaceVolume();
      for (const effect of this.effects) {
        const target = clampVolume(base * effect.scale);
        if (effect.gain) effect.gain.gain.value = target;
        else if (effect.sound) effect.sound.volume = target;
      }
    }
    const src = setting("soundBgm")?.trim();
    if (!this.roundActive || !src || !base) {
      this.stopBgm();
      return;
    }
    if (this.bgm?.src === src) {
      if (this.bgm.sound) this.bgm.sound.volume = base;
      return;
    }
    this.stopBgm();
    const job = this.bgm = {src, sound: null};
    void this.playBgm(job);
  }

  async playBgm(job) {
    if (game.audio.locked) await game.audio.unlock;
    if (this.bgm !== job) return;
    const sound = await playAudio(job.src, volume(), true);
    if (this.bgm !== job) stopAudio(sound);
    else if (sound) {
      job.sound = sound;
      sound.volume = volume();
    } else this.bgm = null;
  }
}
