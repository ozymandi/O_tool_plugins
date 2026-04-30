# O'Align Panel Design

## Purpose

Tracks the UI design state of the O'Align CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Direction selector, Pivot selector, Action, Status footer
- Controls: two segmented rows (3 segments each), one primary action button
- Interaction: panel persists settings via localStorage, single ALIGN action

## Current Structure

- `Direction`
  - Segmented buttons: AUTO / HORIZONTAL / VERTICAL
- `Pivot`
  - Segmented buttons: CENTER / FIRST POINT / SECOND POINT
- Action: `ALIGN` (primary)
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- AUTO mirrors the original "Smart Snap" logic (≤45° = horizontal, otherwise vertical)
- HORIZONTAL/VERTICAL force the result regardless of input angle
- Pivot CENTER uses the bounding-box center (matches original)
- Pivot FIRST POINT or SECOND POINT keeps that anchor point fixed during rotation; the rotation is computed against the bounding-box center then translated to compensate
- The host always rotates the highest non-Layer parent (Group, Compound Path, or single object)

## Iteration Log

### 2026-04-30

- Initial port from `O'Align.jsx` to a CEP panel
- Replaced the fixed Smart Snap with an explicit Direction toggle
- Added Pivot selector to allow rotation around a chosen anchor point
- Status reports the chosen direction and the actual rotation applied (deg)
