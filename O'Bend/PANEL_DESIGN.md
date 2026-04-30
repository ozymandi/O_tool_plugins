# O'Bend Panel Design

## Purpose

Tracks the UI design state of the O'Bend CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Axis, Bend, Helix, Action, Status
- Controls: segmented rows, slider capsules with reset, paired numeric/range inputs
- Interaction: stateless apply-on-click; user adjusts parameters then clicks APPLY

## Current Structure

- `Axis`
  - Segmented buttons: HORIZONTAL / VERTICAL / CUSTOM
  - Custom angle slider capsule (visible only when CUSTOM)
- `Bend`
  - Subdivisions slider (0-7)
  - Bend Angle slider (-1080 to 1080)
  - Limit (%) slider (0-100)
  - Center (%) slider (0-100)
  - Offset (Radius) slider (-2000 to 2000 manual; -500 to 500 on slider)
  - Direction: NORMAL / REVERSE
- `Helix`
  - Radial Expand slider (-1000 to 1000 manual; -200 to 200 on slider)
  - Axis Shift (Z) slider (-2000 to 2000 manual; -500 to 500 on slider)
- Action: APPLY (primary) + RESET
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- The original ScriptUI dialog had Live Preview; the CEP version drops it for stateless apply
- Each parameter has a per-slider Reset button to its default value; the panel-level RESET sets all parameters
- Slider ranges are tight for ergonomics, but number fields allow much larger manual entry
- Bipolar sliders (Offset, Radial Expand, Axis Shift) show the fill from 0 outwards
- High Subdivisions on complex paths take seconds; status shows progress label

## Iteration Log

### 2026-04-30

- Initial port from `O'Bend.jsx v15.2` to a CEP panel
- Replaced ScriptUI sliders + dialog with CEP slider capsules and persistent panel
- Dropped Live Preview in favor of stateless APPLY + Ctrl+Z
- Kept the bend math (rotatePoint, transformPointPolar, transformHandleJacobianCentral, mathSubdivide, normalizeHandles) verbatim in host
- Compound path support kept verbatim from v15.2 fix
