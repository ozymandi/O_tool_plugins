# O'Fit Panel Design

## Purpose

Tracks the UI design state of the O'Fit CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Fit Mode, Padding, Align grid, Action, Status footer
- Controls: 3-segment row for fit mode, paired number inputs for padding, 3x3 grid of dot buttons for alignment, primary action button
- Interaction: panel persists settings via localStorage, single FIT action processes all selected items independently

## Current Structure

- `Fit Mode`
  - Segmented buttons: CONTAIN / COVER / STRETCH
- `Padding (px)`
  - Horizontal padding
  - Vertical padding
- `Align`
  - 3x3 grid of dot buttons (top/middle/bottom x left/center/right)
- Action: `FIT TO ARTBOARD` (primary)
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- CONTAIN scales by min(scaleX, scaleY) so the whole object stays inside (matches the original script)
- COVER scales by max(scaleX, scaleY); object can overflow the artboard
- STRETCH uses scaleX and scaleY independently, ignoring aspect ratio
- Padding shrinks the available space symmetrically on each axis (so 10px H pad = 10px on left + 10px on right)
- Align grid uses small centered dots that grow and glow when active for an obvious selected state
- Each selected item is fitted independently using the active artboard

## Iteration Log

### 2026-04-30

- Initial port from `O'Fit.jsx` to a CEP panel
- Original script always used CONTAIN + center; this panel adds COVER and STRETCH plus a 9-position alignment grid
- Added Padding controls so the user can leave a margin around the artboard edges
- Multi-item support: original took only `selection[0]`; the CEP version processes every selected item
