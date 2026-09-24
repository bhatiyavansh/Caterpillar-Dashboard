# Design

## 1. Palette and tokens (`src/app/globals.css` `@theme`)

- **Ink surfaces:** `ink-950` to `ink-600`. Panels use the `panel` and `panel-raised` glass utilities.
- **Brand:** `cat-500` #FFCD11 is used for the selected, primary and brand states only. `cat-400` is its hover and `cat-600` its pressed state.
- **Status:** `status-ok` #3DDC84, `status-warn` #FFB020, `status-crit` #FF4D4F, `status-info` #4AA8FF. Use them only when something needs attention.
- **Text:** `zinc-50`/`100` for primary text, `muted` #9AA3AD for labels.
- **Radius:** plain `rounded` resolves to `--radius`, 0.625rem. Cards use `rounded-2xl`, and pills and chips use `rounded-full`.
- **HMI:** the in-cab HMI uses the same tokens. `C` in `hmi-ui.tsx` mirrors them for SVG and motion colours.

## 2. Type

- **UI:** Inter.
- **Readouts:** JetBrains Mono for tabular numbers.
- **Case:** headings, tabs and buttons are sentence case. `label-xs` (small uppercase) is kept for section eyebrows.

## 3. Components

- **Primitives:** `src/components/ui/*` provides Button, Card, Badge, Progress, Select and Input (rounded-xl with a focus colour), Tabs (sentence case), and EmptyState.
- **In-cab HMI:**
  - Glass cards float over the live machine.
  - The status bar has a clock, a weather chip and the lamp pill.
  - Cluster: speed gauge, segmented gear selector, and icon meter rows.
  - The dock has large touch targets.
  - The test bench is split into four tabs.
- **X-ray:** a fresnel shell with the flagged assembly lit in amber. The component card sits beside the component.

## 4. Site and fleet inventory

The site is 360 m square, with valley walls beyond the fence at ±152 m.

- **Benched pit (Zone B):**
  - Floor at −4.6 m, benches at −3.1 m and −1.6 m.
  - An 11.5% embankment ramp, with berms and guardrails on both sides.
  - Spoil on the floor for the dozer.
- **Waste dump:** a +6 m tip head with a crest berm, reached by a 20% loose-spoil ramp that has berms and guardrails.
- **Bench face C:** a 5.5 m over-steep cut that fails under load, with a floor and an exit slope.
- **Sidehill bench:** a 13° cross-slope on the east spoil bank.
- **Trenches:** two service trenches, each with a spoil ridge.
- **Windrows:** along the haul roads, with gaps at every junction.
- **Stockpile:** a mound and spoil heaps.
- **Loading pad, maintenance pad and fuel bay.**
- **Settling pond:** with a wet-clay ring.
- **Crusher:** hopper walls, the crusher house and a conveyor.
- **Site office and containers, and light masts.**
- **Perimeter fence:** with a gate where the haul road leaves site.

The fleet in the twin is four machines. All are rigid bodies; see `PHYSICS.md`.

| Machine | Role |
|---|---|
| EXC001, CAT 320 | operator-driven |
| DOZ001, D6 | works the pit floor |
| WHL001, 950 | stockpile to loading |
| TRK001, 745 | reverses in to load and to tip |
