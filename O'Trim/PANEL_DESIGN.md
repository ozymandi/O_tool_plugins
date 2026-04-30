# O'Trim Panel Design

## Purpose

Tracks the UI design state of the O'Trim CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: stacked sections — Mode, Grid, Transform, Action, Status
- Controls: segmented mode selector, paired number fields, slider capsule for scale, custom dropdown for anchor
- Interaction: panel persists settings via localStorage, mode constrains which axis inputs are editable

## Current Structure

- `Mode`
  - Segmented buttons: COLS / ROWS / GRID
- `Grid`
  - X (Cols) — disabled in ROWS mode
  - Y (Rows) — disabled in COLS mode
- `Transform`
  - Scale (%) slider capsule (1-200 in slider, up to 500 manual)
  - Proportional scale checkbox
  - Gap (px)
  - Anchor dropdown (Center / Top-Left / Top-Right / Bottom-Left / Bottom-Right)
- Action: `TRIM` (primary)
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- Switching modes auto-locks the unused axis input to 1 to keep host-side validation simple
- Scale slider caps at 200% for ergonomics; the number field accepts up to 500
- Number fields support wheel changes and scrub handles
- The host always groups the selection first as a safety, mirroring the original script
- Host operation consumes the source object and stacks the resulting cells with the chosen Gap

## Iteration Log

### 2026-04-30

- Initial port from `O'Trim.jsx` ScriptUI dialog to a CEP panel
- Replaced the radio-button mode group with a segmented control
- Replaced the anchor dropdownlist with the design-system custom dropdown
- Added a slider capsule for Scale with manual range 1-500 and slider range 1-200
- Reused the original Mask Hunter alignment logic in `host/index.jsx` verbatim
- Mode constraints in the panel mirror the original input enable/disable behavior
