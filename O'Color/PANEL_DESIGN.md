# O'Color Panel Design

## Purpose

Tracks the UI design state of the O'Color CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Apply-to checkboxes, Source check, Action, Status footer
- Stateless single-action panel: each RANDOMIZE click re-rolls

## Current Structure

- `Apply to`
  - Fill checkbox (default ON)
  - Stroke checkbox (default OFF)
- `Source`
  - CHECK SWATCHES button + status line showing the count of swatches currently selected in the Swatches panel
- `Action`
  - RANDOMIZE primary button
- `Status`
  - Indicator dot + status text + footer note

## Current UI Rules

- The RANDOMIZE button is disabled while neither Fill nor Stroke is checked
- CHECK SWATCHES queries the host for the current `getSelected().length` and reports it; useful because there is no native CEP event when the swatch selection changes
- After each randomize, the status reports how many leaf items were touched and the swatch count used
- Recursion into groups, special handling for compound paths and text frames is preserved verbatim from the original script

## Iteration Log

### 2026-05-01

- Initial port from `O'Color.jsx` (Random Color Pro) to a CEP panel
- Replaced the modal Window dialog with a persistent panel: each RANDOMIZE click runs once on the current selection
- Added a CHECK SWATCHES helper to surface the current swatch selection count, since CEP cannot listen to Illustrator's swatch selection events
- Settings persist via localStorage so Fill/Stroke toggles survive panel reloads
