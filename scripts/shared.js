export const MODULE_ID = "crystal-trials-minigame";
export const SOCKET = `module.${MODULE_ID}`;

export function t(key, data) {
  const path = `CrystalTrials.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function serverTime() {
  return game.time.serverTime;
}

export function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
