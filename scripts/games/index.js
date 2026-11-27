import {AimGame} from "./aim.js";
import {BeamsGame} from "./beams.js";
import {GravityGame} from "./gravity.js";
import {MazeGame} from "./maze.js";
import {OrbitGame} from "./orbit.js";
import {ResonanceGame} from "./resonance.js";
import {ShardsGame} from "./shards.js";
import {ShieldGame} from "./shield.js";
import {SigilGame} from "./sigil.js";
import {TimingGame} from "./timing.js";

export const DIFFICULTIES = ["easy", "medium", "hard", "insane"];
export const GAMES = {
  shards: {Game: ShardsGame, duration: [10, 11, 12, 13], maxProgress: [0, 0, 0, 0]},
  resonance: {Game: ResonanceGame, duration: [10, 11, 12, 13], maxProgress: [0, 0, 0, 0]},
  beams: {Game: BeamsGame, duration: [10, 11, 12, 13], maxProgress: [0, 0, 0, 0]},
  gravity: {Game: GravityGame, duration: [10, 11, 12, 13], maxProgress: [0, 0, 0, 0]},
  timing: {Game: TimingGame, duration: [7.8, 8.6, 9.0, 9.8], maxProgress: [4, 5, 7, 9]},
  maze: {Game: MazeGame, duration: [18, 15, 13, 12], maxProgress: [1, 1, 1, 1]},
  shield: {Game: ShieldGame, duration: [10, 11, 12, 13], maxProgress: [80, 80, 80, 80]},
  aim: {Game: AimGame, duration: [11, 11.5, 12, 12.5], maxProgress: [6, 8, 10, 13]},
  sigil: {Game: SigilGame, duration: [11, 11, 11, 10.5], maxProgress: [7, 10, 13, 16]},
  orbit: {Game: OrbitGame, duration: [10, 11, 12, 13], maxProgress: [0, 0, 0, 0]}
};
