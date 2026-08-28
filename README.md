# Vacuum Card

A robot vacuum as one card: what it is, what to clean with, where, and go.

```
🤖 Robot                             Docked   87%
─────────────────────────────────────────────────
[ Sweeping ]  [ Mopping ]  [ Mop after sweep ]
[ Quiet ] [ Standard ] [ Strong ] [ Turbo ]
[ Room one ]  [ Room two ]
[ ▶ Start ]                        [ ⌂ Dock ]
```

No map. The map camera is a picture of the floorplan rather than a control, and
it pushes everything worth pressing below the fold.

## What it does differently

**Cleaning mode is three buttons, not four.** The robot has four values —
`sweeping`, `mopping`, `sweeping_and_mopping`, `mopping_after_sweeping` — but
that is two independent halves and one order. Sweeping and Mopping are toggles;
both lit *is* `sweeping_and_mopping`. Mop after sweep is the sequential mode:
it needs both halves, so it is only reachable from there, and the first two stay
lit while it is active instead of appearing to switch themselves off.

**Rooms are a selection, not an order.** Tapping a room marks it. Nothing moves
until Start, which sits underneath the rooms it will act on. Nothing selected
starts the whole floor.

**One button for start, pause and resume.** A Pause button beside a Start button
is dead half the time. This one is Start while docked, Pause while running, and
Resume when paused — where Resume carries on the job rather than beginning a new
one. Dock is the stop: a robot halted where it stands is a robot you go and
fetch.

**The rooms come off the robot's own map.** Nothing is written down in the card
config. The integration exposes each map segment as
`select.<robot>_room_<n>_suction_level`, whose friendly name carries the room
name, so re-splitting or renaming rooms in the vendor app changes the buttons.
Segments the robot has not been given a name for - the ones it still calls
"Room 3" - are skipped: an unnamed segment is a scrap of floor, not a room.

## Install

### HACS

HACS → Frontend → ⋮ → Custom repositories → add
`https://github.com/cosmicKev/ha-vacuum-card` as **Dashboard**, then install
*Vacuum Card*.

### Manually

Copy `dist/ha-vacuum-card.js` to `config/www/community/ha-vacuum-card/` and add
the resource:

```yaml
# Settings → Dashboards → ⋮ → Resources
url: /local/community/ha-vacuum-card/ha-vacuum-card.js
type: module
```

## Use

```yaml
type: custom:vacuum-card
entity: vacuum.robot
```

Everything else is found from that entity: the card looks for the robot's other
entities on the same device, falling back to matching entity-id stems where the
frontend does not expose a device.

| Option | Default | What |
|---|---|---|
| `entity` | — | **Required.** The `vacuum.` entity |
| `name` | the entity's name | Title shown in the header |
| `icon` | `mdi:robot-vacuum` | Header icon |
| `show_modes` | `true` | The cleaning-mode row |
| `show_suction` | `true` | The suction row |
| `show_rooms` | `true` | The room selection row |
| `show_battery` | `true` | Battery badge in the header |
| `segment_service` | `dreame_vacuum.vacuum_clean_segment` | Service used to clean selected rooms |
| `segment_field` | `segments` | Name of that service's segment-list field |

Rows whose entities do not exist are simply not drawn, so a robot without a
`cleaning_mode` select shows the rest and nothing breaks.

### Another vendor

The mode and suction rows read plain `select` entities and the room list reads
the segment selects, so any integration that names things the same way works
as-is. If your integration cleans rooms through a different service, point
`segment_service` and `segment_field` at it:

```yaml
type: custom:vacuum-card
entity: vacuum.robot
segment_service: xiaomi_miio.vacuum_clean_segment
segment_field: segments
```

## Written without a build step

The file that ships is the file that was written — a plain custom element, no
Lit, no bundler, nothing to compile. It styles itself entirely from Home
Assistant's own theme variables, so it follows whatever theme is active.

## Licence

MIT
