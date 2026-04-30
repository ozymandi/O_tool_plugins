# O'Select Panel Design

## Purpose

Tracks the UI design state of the O'Select CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: two checkbox grids (Include / Skip), single primary action, status footer
- Controls: native checkboxes in a two-column grid, a single primary action button
- Interaction: panel persists settings via localStorage, shows feedback in status footer

## Current Structure

- `Include`
  - Paths
  - Compound paths
  - Text frames
  - Raster images
  - Mesh items
  - Placed / Linked
- `Skip`
  - Clipping paths
  - Hidden items
  - Locked items
- Action: `SELECT OBJECTS` (primary)
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- Default include set matches the original script: paths, compound paths, text frames
- Default skip set matches the original: clipping paths, hidden, locked
- Settings persist between sessions
- The panel always operates on the current Illustrator selection; pre-select containers first
- Status reports the count of objects selected after each run

## Iteration Log

### 2026-04-30

- Initial port from `O'Select.jsx` to CEP panel
- Replaced the silent recursive descent with an explicit type filter so users can decide which leaf types to gather
- Added Placed / Linked items as an optional include type; original script ignored those
- Status footer reports the number of leaves selected
