# O'Cone Panel Design

## Purpose

Tracks the UI design state of the O'Cone CEP panel.

## Current Direction

- Dark CEP panel matching the O'Tool design system
- IDLE/ACTIVE state machine with live preview
- Per-item session: each selected shape gets its own clipped fan group
- Two parameters only: Style preset (5 options) and Quality (segments count)

## Current Structure

- `Style` (lockable) — custom dropdown with 5 presets (Silver, Gold, Holographic, Radar, Spectrum)
- `Quality` (lockable) — slider capsule for segment count (slider 50-720, manual up to 2000)
- `Action`
  - IDLE: primary `CONE` button only
  - ACTIVE: primary `APPLY` (commits) + `CANCEL` (reverts) + `RESET PARAMETERS`
- `Status` — indicator dot + status text + footer note

## State machine

- **IDLE** — only CONE button is active, parameters dimmed.
- **CONE** click — captures every selected item, builds a `OCone_Result` group per item with: clipping mask (duplicated original on top, clipping=true) + `Fan_Source` group of N triangles below; hides each original. Transitions to ACTIVE.
- **ACTIVE** — parameters editable. Live updates fire through an in-flight queue (no debounce):
  - **Style change only** → fast path: iterate existing fan triangles and update fillColor (no geometry rebuild)
  - **Quality change** → drop fan path items and rebuild with new segment count
  - Both at once → quality rebuild path subsumes the colour update
- **APPLY** — removes the originals (which were hidden), keeps the result groups, returns to IDLE.
- **CANCEL** — removes the result groups and unhides originals, returns to IDLE.

## Optimisation rationale

Style change is by far the more common interaction (user iterating presets). Rebuilding 720 triangles per shape per Style change would be wasteful. Keeping geometry intact and only swapping `fillColor` references makes Style switching effectively instant even on multi-shape selections.

Quality change is rarer and inherently requires a fresh fan, so it rebuilds.

## Iteration Log

### 2026-05-01

- Initial CEP port of `O'Cone.jsx` v3 (Mask Fix).
- Replaced the modal Window with an IDLE/ACTIVE panel and live preview.
- Added the Style-only fast path: updateColors iterates `fanGroup.pathItems` and only changes their `fillColor` based on segment angle, bypassing geometry rebuild.
- Per-item session lets multi-shape selections coexist; each shape has its own preview that survives until APPLY/CANCEL.
- Colour engine (`getColorForStyle` with the original 5 stop tables) is preserved verbatim.
