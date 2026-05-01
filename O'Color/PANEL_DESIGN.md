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
- `Action`
  - RANDOMIZE primary button
- `Status`
  - Indicator dot + status text (shows current swatch count and randomize result)

## Current UI Rules

- The RANDOMIZE button is disabled while neither Fill nor Stroke is checked
- On panel init, the handshake reports the current swatch selection count in the status footer
- After each randomize, the status reports how many leaf items were touched and the swatch count used; if no swatches are selected, the error message guides the user
- Recursion into groups, special handling for compound paths and text frames is preserved verbatim from the original script

## Iteration Log

### 2026-05-01

- Initial port from `O'Color.jsx` (Random Color Pro) to a CEP panel
- Replaced the modal Window dialog with a persistent panel: each RANDOMIZE click runs once on the current selection
- Settings persist via localStorage so Fill/Stroke toggles survive panel reloads

### 2026-05-01 (revision)

- Removed the CHECK SWATCHES button and Source section: status footer already reports the swatch count after RANDOMIZE, and the handshake surfaces the initial count on panel load. The dedicated button was redundant.
