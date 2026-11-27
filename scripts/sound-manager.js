import {MODULE_ID, setting} from "./shared.js";

export const SOUND_FILES = {
  Open: "open.wav",
  Countdown: "countdown.wav",
  Start: "start.wav",
  Hit: "hit.wav",
  Telegraph: "telegraph.wav",
  BeamFire: "beam-fire.wav",
  TimingHit: "timing-hit.wav",
  Jump: "jump.wav",
  ShardWave: "shard-wave.wav",
  GateWarn: "gate-warn.wav",
  ShieldBlock: "shield-block.wav",
  Win: "win.wav",
  Lose: "lose.wav",
  Close: "close.wav",
  Bgm: ""
};

const UNTRACKED = new Set(["Close", "Win", "Lose"]);

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
      onChange: key === "Bgm" ? onChange : undefined
    });
  }
}

function volume() {
  return setting("muteLocal") ? 0 : setting("masterVolume");
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value));
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
  bgm = null;
  roundActive = false;

  play(key, scale = 1) {
    const src = setting(`sound${key}`)?.trim();
    const level = clampVolume(volume() * scale);
    // A browser that has not received a user gesture must not queue a round's worth of cues.
    if (!src || !level || game.audio.locked) return;
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
    for (const effect of this.effects) stopAudio(effect.sound);
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
      for (const effect of this.effects) {
        if (effect.sound) effect.sound.volume = clampVolume(base * effect.scale);
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
