import {DIFFICULTIES, GAMES} from "./games/index.js";
import {element, t} from "./shared.js";

const {ApplicationV2} = foundry.applications.api;

const lastConfig = {
  gameType: "random",
  difficulty: "medium",
  lives: "3",
  title: "",
  localOnly: false
};

function option(value, label) {
  const node = element("option", null, label);
  node.value = value;
  return node;
}

function field(label, input) {
  const wrapper = element("label", "ct-field");
  wrapper.append(element("span", null, label), input);
  return wrapper;
}

export class GmLauncher extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ct-launcher",
    classes: ["ct-launcher", "themed", "theme-dark"],
    position: {width: 408},
    window: {icon: "fa-solid fa-gem", title: "CrystalTrials.Title", resizable: false}
  };

  constructor(api, getSession) {
    super();
    this.api = api;
    this.getSession = getSession;
  }

  get title() {
    return t("Title");
  }

  async open() {
    if (!this.rendered) await this.render({force: true});
    else {
      if (this.minimized) await this.maximize();
      this.bringToFront();
    }
    this.refreshPlayers(true);
    this.refreshSession();
    return this;
  }

  async _renderHTML() {
    const form = element("form", "ct-launch-form");
    this.player = element("select");
    this.player.name = "userId";

    this.secondPlayer = element("select");
    this.secondPlayer.name = "secondUserId";

    const playerColumns = element("div", "ct-field-columns");
    playerColumns.append(field(t("Launcher.Player1"), this.player), field(t("Launcher.Player2"), this.secondPlayer));

    this.mode = element("select");
    this.mode.name = "gameType";
    this.mode.append(...["random", ...Object.keys(GAMES)].map(key => option(key, t(`Games.${key}.Name`))));
    this.mode.value = lastConfig.gameType;

    this.difficulty = element("select");
    this.difficulty.name = "difficulty";
    this.difficulty.append(...DIFFICULTIES.map(key => option(key, t(`Difficulty.${key}`))));
    this.difficulty.value = lastConfig.difficulty;

    this.lives = element("select");
    this.lives.name = "lives";
    this.lives.append(...[1, 2, 3, 4, 5].map(value => option(value, value)));
    this.lives.value = lastConfig.lives;

    const columns = element("div", "ct-field-columns");
    columns.append(field(t("Launcher.Difficulty"), this.difficulty), field(t("Launcher.Lives"), this.lives));

    this.preview = element("div", "ct-mode-preview");

    this.titleInput = element("input");
    this.titleInput.name = "title";
    this.titleInput.type = "text";
    this.titleInput.maxLength = 100;
    this.titleInput.value = lastConfig.title;

    const localRow = element("label", "ct-checkbox-field");
    this.localOnly = element("input");
    this.localOnly.type = "checkbox";
    this.localOnly.name = "localOnly";
    this.localOnly.checked = lastConfig.localOnly;
    const localText = element("span", null, t("Launcher.LocalTest"));
    localRow.title = t("Launcher.LocalTestHint");
    localRow.append(this.localOnly, localText);

    this.status = element("p", "ct-launch-status");
    this.status.setAttribute("aria-live", "polite");
    this.launchButton = element("button", "ct-launch-button", t("Launcher.Start"));
    this.launchButton.type = "submit";
    this.abortButton = element("button", "ct-abort-button", t("Launcher.Abort"));
    this.abortButton.type = "button";
    const actions = element("div", "ct-launch-actions");
    actions.append(this.launchButton, this.abortButton);

    form.append(
      playerColumns,
      field(t("Launcher.Game"), this.mode),
      columns,
      this.preview,
      field(t("Launcher.CustomTitle"), this.titleInput),
      localRow,
      this.status,
      actions
    );

    const saveConfig = () => {
      lastConfig.gameType = this.mode.value;
      lastConfig.difficulty = this.difficulty.value;
      lastConfig.lives = this.lives.value;
      lastConfig.title = this.titleInput.value;
      lastConfig.localOnly = this.localOnly.checked;
      this.refreshPreview();
    };

    this.player.addEventListener("change", () => {
      this.syncSecondPlayerOptions();
      this.syncLocalOnlyState();
    });
    this.secondPlayer.addEventListener("change", () => this.syncLocalOnlyState());
    this.mode.addEventListener("change", saveConfig);
    this.difficulty.addEventListener("change", saveConfig);
    this.lives.addEventListener("change", saveConfig);
    this.titleInput.addEventListener("input", saveConfig);
    this.localOnly.addEventListener("change", saveConfig);

    form.addEventListener("submit", event => {
      event.preventDefault();
      saveConfig();
      try {
        this.api.start({
          userId: this.player.value,
          secondUserId: this.secondPlayer.value || undefined,
          gameType: this.mode.value,
          difficulty: this.difficulty.value,
          lives: this.lives.value,
          title: this.titleInput.value,
          localOnly: this.localOnly.checked && !this.localOnly.disabled
        });
      } catch (error) {
        ui.notifications.warn(error.message);
      }
    });

    this.abortButton.addEventListener("click", () => {
      try {
        this.api.abort();
      } catch (error) {
        ui.notifications.warn(error.message);
      }
    });

    return form;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender() {
    this.refreshPlayers(true);
    this.refreshPreview();
    this.refreshSession();
  }

  _onClose() {
    this.player = this.secondPlayer = this.mode = this.difficulty = this.lives = null;
    this.preview = this.titleInput = this.localOnly = this.status = this.launchButton = this.abortButton = null;
  }

  refreshPreview() {
    if (!this.preview || !this.mode || !this.difficulty) return;
    const gameType = this.mode.value;
    const level = DIFFICULTIES.indexOf(this.difficulty.value);
    this.preview.classList.toggle("ct-preview-insane", this.difficulty.value === "insane");
    if (gameType === "random") {
      this.preview.textContent = t("Games.random.Help");
      return;
    }
    const seconds = GAMES[gameType].duration[Math.max(0, level)];
    const help = t(`Games.${gameType}.Help`);
    this.preview.textContent = t("Launcher.DurationHint", {seconds, help});
  }

  syncSecondPlayerOptions() {
    if (!this.player || !this.secondPlayer) return;
    const first = this.player.value;
    const currentSecond = this.secondPlayer.value;
    const players = game.users.filter(user => user.active && !user.isGM);
    const candidates = [...players, game.user].filter(user => user.id !== first);

    this.secondPlayer.replaceChildren(
      option("", t("Launcher.NoSecondPlayer")),
      ...candidates.map(user => option(user.id, user.isGM ? t("Launcher.Test", {gm: user.name}) : user.name))
    );
    if (candidates.some(user => user.id === currentSecond)) {
      this.secondPlayer.value = currentSecond;
    } else {
      this.secondPlayer.value = "";
    }
  }

  syncLocalOnlyState() {
    if (!this.localOnly || !this.player || !this.secondPlayer) return;
    const isSelfOnly = this.player.value === game.user.id && !this.secondPlayer.value;
    this.localOnly.disabled = !isSelfOnly;
    if (isSelfOnly) {
      this.localOnly.checked = true;
      lastConfig.localOnly = true;
    } else {
      this.localOnly.checked = false;
    }
  }

  refreshPlayers(preferToken = false) {
    if (!this.player || !this.secondPlayer) return;
    const players = game.users.filter(user => user.active && !user.isGM);
    const selected1 = this.player.value;
    const selected2 = this.secondPlayer.value;

    this.player.replaceChildren(
      ...players.map(user => option(user.id, user.name)),
      option(game.user.id, t("Launcher.Test", {gm: game.user.name}))
    );

    const controlled = game.canvas?.tokens?.controlled ?? [];
    const tokenOwners = [];
    for (const token of controlled) {
      const actor = token.actor;
      if (!actor) continue;
      const owners = players.filter(user => actor.testUserPermission(user, "OWNER"));
      const mainOwner = owners.find(user => user.character?.id === actor.id) ?? owners[0];
      if (mainOwner && !tokenOwners.some(u => u.id === mainOwner.id)) tokenOwners.push(mainOwner);
    }

    if (preferToken && tokenOwners.length >= 1) {
      this.player.value = tokenOwners[0].id;
    } else if ([...players, game.user].some(user => user.id === selected1)) {
      this.player.value = selected1;
    }

    this.syncSecondPlayerOptions();
    if (preferToken && tokenOwners.length >= 2) {
      this.secondPlayer.value = tokenOwners[1].id;
    } else if (selected2 && selected2 !== this.player.value && [...players, game.user].some(u => u.id === selected2)) {
      this.secondPlayer.value = selected2;
    }

    this.syncLocalOnlyState();
  }

  refreshSession() {
    if (!this.status) return;
    const session = this.getSession();
    this.launchButton.disabled = Boolean(session);
    this.abortButton.disabled = !session;
    if (!session) {
      this.status.textContent = "";
      this.status.hidden = true;
      return;
    }
    const names = session.targets.map(target => target.name);
    this.status.textContent = names.length > 1
      ? t("Launcher.RunningDuo", {p1: names[0], p2: names[1]})
      : t("Launcher.Running", {player: names[0]});
    this.status.hidden = false;
  }
}
