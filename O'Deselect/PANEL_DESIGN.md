# O'Deselect Panel Design

## Purpose

Tracks the UI design state of the O'Deselect CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: stacked sections — mode, mode-specific parameters, actions, status footer
- Controls: segmented mode selector, plain number fields, slider capsule for probability
- Interaction: panel persists settings via localStorage, shows feedback in status footer

## Current Structure

- `Mode`
  - Segmented buttons: Sequence / Random
- `Sequence` (visible when mode = sequence)
  - Selected (count)
  - Unselected (count)
  - Offset (integer)
- `Random` (visible when mode = random)
  - Probability slider capsule (0-100%)
- Action row
  - `APPLY`
  - `SAVE SELECTION`
- `Status`
  - Indicator dot
  - Status text
  - Footer note about scope

## Current UI Rules

- The mode segmented buttons toggle which parameter section is visible
- Number fields support wheel changes and scrub handles
- Probability is locked between 0 and 100; reset returns to 50
- Footer feedback stays visible regardless of scroll position
- APPLY adjusts the current selection in place; SAVE SELECTION applies and opens Illustrator's Save Selection dialog
- A single PathItem selection switches the operation to anchor points; multiple objects switch back to objects

## Iteration Log

### 2026-04-30

- Initial port from `O'Deselect.jsx` (ScriptUI dialog) to CEP panel
- Reused `O'Zometrix` dev pattern: manifest, host, css, js, install, uninstall, ZXP scripts
- Replaced the modal dialog + tabbed panel with a stateless panel that operates on the current selection on each APPLY
- Removed Live Preview and Restore Original (rely on Ctrl+Z in Illustrator)
- Kept the original Sequence + Random modes and the Save Selection menu hook
