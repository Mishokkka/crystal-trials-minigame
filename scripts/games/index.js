import {BeamsGame} from "./beams.js";
import {GravityGame} from "./gravity.js";
import {MazeGame} from "./maze.js";
import {ResonanceGame} from "./resonance.js";
import {ShardsGame} from "./shards.js";
import {TimingGame} from "./timing.js";

export const DIFFICULTIES = ["easy", "medium", "hard", "insane"];
export const GAMES = {
  shards: {Game: ShardsGame, duration: [10, 11, 12, 13]},
  resonance: {Game: ResonanceGame, duration: [10, 11, 12, 13]},
  beams: {Game: BeamsGame, duration: [10, 11, 12, 13]},
  gravity: {Game: GravityGame, duration: [10, 11, 12, 13]},
  timing: {Game: TimingGame, duration: [7.8, 8.6, 9.0, 9.8]},
  maze: {Game: MazeGame, duration: [18, 15, 13, 12]}
};
