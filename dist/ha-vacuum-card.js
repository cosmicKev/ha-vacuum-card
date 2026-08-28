/*
 * Vacuum Card - a robot vacuum as one card: what it is, what to clean with,
 * where, and go.
 *
 * Written as a plain custom element rather than a Lit component so the file
 * that ships is the file that was written - no build step, nothing to compile,
 * and no version of Lit fighting the one Home Assistant already loaded.
 *
 * Everything it needs it finds from the vacuum entity: the integration puts the
 * robot's selects and sensors on the same device, and its map segments arrive
 * as `select.<robot>_room_<n>_suction_level` whose friendly name carries the
 * room name. So the rooms on the card follow the robot's map without anything
 * being written down here.
 */

/* The element is `ha-vacuum-card`, not `vacuum-card`: the shorter name belongs
 * to denysdovhan/vacuum-card, which predates this by years and is installed on
 * plenty of systems. Two cards defining one name means whichever loads second
 * throws, and the loser is whoever the user installed most recently. */
const CARD_VERSION = "1.0.1";

/* Cleaning is two independent halves and one order. `sweeping_and_mopping` is
 * both halves at once; `mopping_after_sweeping` is both halves in sequence -
 * which is why the first two buttons stay lit while it is active, instead of
 * appearing to switch themselves off. */
const MODE = {
  SWEEP: "sweeping",
  MOP: "mopping",
  BOTH: "sweeping_and_mopping",
  AFTER: "mopping_after_sweeping",
};

const SUCTION_ICONS = {
  quiet: "mdi:volume-low",
  standard: "mdi:fan",
  strong: "mdi:fan-speed-2",
  turbo: "mdi:fan-speed-3",
};

const RUNNING = ["cleaning", "returning"];
// A segment the robot has not been named is "Room 3" - a scrap of floor, not a
// room worth a button.
const UNNAMED_SEGMENT = /^Room \d+$/i;

const DEFAULTS = {
  show_modes: true,
  show_suction: true,
  show_rooms: true,
  show_battery: true,
  segment_service: "dreame_vacuum.vacuum_clean_segment",
  segment_field: "segments",
};

class VacuumCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = new Set();
    this._rendered = "";
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
  }

  static getStubConfig(hass) {
    const vacuum = Object.keys(hass.states).find((id) => id.startsWith("vacuum."));
    return { type: "custom:ha-vacuum-card", entity: vacuum || "vacuum.robot" };
  }

  setConfig(config) {
    if (!config || !config.entity || !config.entity.startsWith("vacuum.")) {
      throw new Error("Set `entity` to a vacuum entity");
    }
    this._config = { ...DEFAULTS, ...config };
    this._rendered = "";
  }

  getCardSize() {
    return 5;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  /* ---------------------------------------------------------------- lookup */

  /** Entities belonging to the same physical robot.
   *
   * By device where the frontend exposes one, and by entity-id prefix where it
   * does not - `vacuum.robot` and `select.robot_suction_level` share a stem even
   * on installs whose device registry the card cannot see.
   */
  _siblings() {
    const hass = this._hass;
    const id = this._config.entity;
    const registry = hass.entities || {};
    const device = registry[id] && registry[id].device_id;
    const stem = id.split(".")[1];
    return Object.keys(hass.states).filter((candidate) => {
      if (device && registry[candidate] && registry[candidate].device_id) {
        return registry[candidate].device_id === device;
      }
      return candidate.split(".")[1].startsWith(`${stem}_`);
    });
  }

  _find(domain, suffix) {
    const explicit = this._config[`${suffix.replace(/^_/, "")}_entity`];
    if (explicit) return explicit;
    return this._siblings().find(
      (id) => id.startsWith(`${domain}.`) && id.endsWith(suffix)
    );
  }

  /** [{id, name}] for every named segment on the robot's map. */
  _segments() {
    const hass = this._hass;
    const rooms = [];
    for (const id of this._siblings()) {
      const match = id.match(/_room_(\d+)_suction_level$/);
      if (!match || !id.startsWith("select.")) continue;
      const state = hass.states[id];
      const friendly = (state && state.attributes.friendly_name) || "";
      // "<robot> Suction Level Kitchen" -> "Kitchen"
      const name = friendly.replace(/^.*Suction Level\s*/i, "").trim();
      if (name && !UNNAMED_SEGMENT.test(name)) {
        rooms.push({ id: Number(match[1]), name });
      }
    }
    return rooms.sort((a, b) => a.id - b.id);
  }

  _state(id) {
    const state = this._hass.states[id];
    return state ? state.state : undefined;
  }

  /* --------------------------------------------------------------- actions */

  _call(domain, service, data) {
    this._hass.callService(domain, service, data);
  }

  _setMode(half) {
    const select = this._find("select", "_cleaning_mode");
    if (!select) return;
    const current = this._state(select);
    const sequential = current === MODE.AFTER;
    let sweeping = sequential || current === MODE.SWEEP || current === MODE.BOTH;
    let mopping = sequential || current === MODE.MOP || current === MODE.BOTH;

    if (half === "after") {
      // Sequential only means something when it does both, and the button is
      // drawn dim until then.
      if (!(sweeping && mopping)) return;
      this._call("select", "select_option", {
        entity_id: select,
        option: sequential ? MODE.BOTH : MODE.AFTER,
      });
      return;
    }

    if (half === "sweep") sweeping = !sweeping;
    if (half === "mop") mopping = !mopping;

    let option = MODE.SWEEP;
    if (sweeping && mopping) option = sequential ? MODE.AFTER : MODE.BOTH;
    else if (mopping) option = MODE.MOP;
    // Neither half leaves nothing to do, so it falls back to sweeping.

    this._call("select", "select_option", { entity_id: select, option });
  }

  _startOrPause() {
    const state = this._state(this._config.entity);
    if (RUNNING.includes(state)) {
      this._call("vacuum", "pause", { entity_id: this._config.entity });
      return;
    }
    // Paused means carry on with the job it was doing, not begin a new one.
    if (state === "paused") {
      this._call("vacuum", "start", { entity_id: this._config.entity });
      return;
    }
    if (this._selected.size) {
      const [domain, service] = this._config.segment_service.split(".");
      this._call(domain, service, {
        entity_id: this._config.entity,
        [this._config.segment_field]: [...this._selected].sort((a, b) => a - b),
      });
      return;
    }
    this._call("vacuum", "start", { entity_id: this._config.entity });
  }

  _onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target || target.hasAttribute("disabled")) return;
    const { action, value } = target.dataset;

    if (action === "mode") this._setMode(value);
    if (action === "suction") {
      const select = this._find("select", "_suction_level");
      if (select) {
        this._call("select", "select_option", { entity_id: select, option: value });
      }
    }
    if (action === "room") {
      const id = Number(value);
      if (this._selected.has(id)) this._selected.delete(id);
      else this._selected.add(id);
      this._rendered = "";
      this._render();
    }
    if (action === "start") this._startOrPause();
    if (action === "dock") {
      this._call("vacuum", "return_to_base", { entity_id: this._config.entity });
    }
    if (action === "more-info") {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: this._config.entity },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  /* ---------------------------------------------------------------- render */

  _batteryIcon(level, charging) {
    if (level === undefined || isNaN(level)) return "mdi:battery-unknown";
    const step = Math.round(level / 10) * 10;
    if (charging) return step >= 100 ? "mdi:battery-charging-100" : `mdi:battery-charging-${Math.max(step, 10)}`;
    if (step >= 100) return "mdi:battery";
    if (step <= 0) return "mdi:battery-outline";
    return `mdi:battery-${step}`;
  }

  _button({ action, value, label, icon, active, disabled }) {
    return `
      <button class="chip${active ? " active" : ""}" data-action="${this._esc(action)}"
              ${value !== undefined ? `data-value="${this._esc(value)}"` : ""}
              ${disabled ? "disabled" : ""}>
        <ha-icon icon="${this._esc(icon)}"></ha-icon>
        <span>${this._esc(label)}</span>
      </button>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const config = this._config;
    const vacuum = this._hass.states[config.entity];
    if (!vacuum) {
      this.shadowRoot.innerHTML =
        `<ha-card><div class="pad">${this._esc(config.entity)} is not available</div></ha-card>`;
      return;
    }

    const stateSensor = this._find("sensor", "_state");
    const batterySensor = this._find("sensor", "_battery_level");
    const chargingSensor = this._find("binary_sensor", "_charging_state");
    const modeSelect = this._find("select", "_cleaning_mode");
    const suctionSelect = this._find("select", "_suction_level");

    const status = stateSensor ? this._state(stateSensor) : vacuum.state;
    const battery = batterySensor
      ? Number(this._state(batterySensor))
      : Number(vacuum.attributes.battery_level);
    const charging = chargingSensor ? this._state(chargingSensor) === "on" : false;

    const mode = modeSelect ? this._state(modeSelect) : undefined;
    const sequential = mode === MODE.AFTER;
    const sweeping = sequential || mode === MODE.SWEEP || mode === MODE.BOTH;
    const mopping = sequential || mode === MODE.MOP || mode === MODE.BOTH;

    const running = RUNNING.includes(vacuum.state);
    const paused = vacuum.state === "paused";
    const name = config.name || vacuum.attributes.friendly_name || config.entity;

    const rows = [];

    if (config.show_modes && modeSelect) {
      rows.push(`<div class="row three">
        ${this._button({ action: "mode", value: "sweep", label: "Sweeping", icon: "mdi:broom", active: sweeping })}
        ${this._button({ action: "mode", value: "mop", label: "Mopping", icon: "mdi:water", active: mopping })}
        ${this._button({
          action: "mode",
          value: "after",
          label: "Mop after sweep",
          icon: "mdi:water-sync",
          active: sequential,
          // Sequential is only reachable from both halves being on.
          disabled: !(sweeping && mopping),
        })}
      </div>`);
    }

    if (config.show_suction && suctionSelect) {
      const options = this._hass.states[suctionSelect].attributes.options || [];
      const current = this._state(suctionSelect);
      rows.push(`<div class="row four">
        ${options
          .map((option) =>
            this._button({
              action: "suction",
              value: option,
              label: option.charAt(0).toUpperCase() + option.slice(1).replace(/_/g, " "),
              icon: SUCTION_ICONS[option] || "mdi:fan",
              active: option === current,
            })
          )
          .join("")}
      </div>`);
    }

    const segments = config.show_rooms ? this._segments() : [];
    if (segments.length) {
      rows.push(`<div class="row three">
        ${segments
          .map((room) =>
            this._button({
              action: "room",
              value: room.id,
              label: room.name,
              icon: "mdi:map-marker",
              active: this._selected.has(room.id),
            })
          )
          .join("")}
      </div>`);
    }

    // Start is last, under the rooms it acts on: the card reads top to bottom -
    // what to clean with, how hard, where, go. One button rather than two,
    // because a Pause beside a Start is dead half the time.
    rows.push(`<div class="row two commands">
      ${this._button({
        action: "start",
        label: running ? "Pause" : paused ? "Resume" : "Start",
        icon: running ? "mdi:pause" : "mdi:play",
        active: running,
      })}
      ${this._button({ action: "dock", label: "Dock", icon: "mdi:home-import-outline" })}
    </div>`);

    const badges = [
      status
        ? `<span class="badge"><ha-icon icon="mdi:information-outline"></ha-icon>${this._esc(this._pretty(status))}</span>`
        : "",
      config.show_battery && !isNaN(battery)
        ? `<span class="badge${battery < 20 ? " low" : ""}">
             <ha-icon icon="${this._esc(this._batteryIcon(battery, charging))}"></ha-icon>${Math.round(battery)}%
           </span>`
        : "",
    ].join("");

    const html = `
      <ha-card>
        <div class="head" data-action="more-info">
          <ha-icon class="robot" icon="${this._esc(config.icon || "mdi:robot-vacuum")}"></ha-icon>
          <div class="name">${this._esc(name)}</div>
          <div class="badges">${badges}</div>
        </div>
        <div class="body">${rows.join("")}</div>
      </ha-card>`;

    if (html === this._rendered) return;
    this._rendered = html;
    this.shadowRoot.innerHTML = `<style>${VacuumCard.styles}</style>${html}`;
  }

  /* Entity names come from the device, and a device is named by whoever set it
   * up - so nothing interpolated into the markup goes in unescaped. */
  _esc(value) {
    return String(value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _pretty(value) {
    return String(value).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

VacuumCard.styles = `
  :host { display: block; }
  ha-card { padding: 12px 14px 14px; }
  .head {
    display: flex; align-items: center; gap: 10px;
    padding-bottom: 10px; margin-bottom: 12px;
    border-bottom: 1px solid var(--divider-color);
    cursor: pointer;
  }
  .head .robot { --mdc-icon-size: 26px; color: var(--state-icon-color, var(--primary-text-color)); }
  .name { font-size: 20px; font-weight: 600; flex: 1; }
  .badges { display: flex; gap: 6px; }
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 15px; color: var(--secondary-text-color);
    background: var(--secondary-background-color); border-radius: 999px;
    padding: 3px 10px; white-space: nowrap;
  }
  .badge ha-icon { --mdc-icon-size: 17px; }
  .badge.low { color: var(--error-color); }
  .body { display: flex; flex-direction: column; gap: 8px; }
  .row { display: grid; gap: 8px; }
  .row.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .row.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .chip {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; min-height: 62px; padding: 8px 6px;
    border: 1px solid transparent; border-radius: 12px;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; text-align: center;
    transition: transform 90ms ease, border-color 120ms ease, color 120ms ease;
  }
  .chip span { line-height: 1.2; }
  .chip ha-icon { --mdc-icon-size: 20px; color: var(--state-icon-color, var(--secondary-text-color)); }
  .chip:active { transform: scale(0.97); }
  .chip.active { border-color: var(--primary-color); color: var(--primary-color); font-weight: 700; }
  .chip.active ha-icon { color: var(--primary-color); }
  .chip[disabled] { opacity: 0.35; cursor: default; }
  .commands .chip { min-height: 56px; }
  .pad { padding: 16px; color: var(--secondary-text-color); }
`;

customElements.define("ha-vacuum-card", VacuumCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-vacuum-card",
  name: "Vacuum Card",
  description:
    "A robot vacuum as one card: state and battery, what to clean with, which rooms, and go.",
  preview: true,
  documentationURL: "https://github.com/cosmicKev/ha-vacuum-card",
});

console.info(`%c VACUUM-CARD %c ${CARD_VERSION} `,
  "color: white; background: #555; font-weight: 700;",
  "color: #555; background: white;");
