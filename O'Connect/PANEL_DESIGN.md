# O'Connect Panel Design

## Purpose

Tracks the UI design state of the O'Connect CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Curve params, Stroke params, Action, Status footer
- Controls: two slider capsules (tension, angle threshold), a number field for stroke width, a custom dropdown for color source
- Interaction: panel persists settings via localStorage, single primary CONNECT action

## Current Structure

- `Curve`
  - Tension slider capsule (number 0-2, slider 0-100 mapping to 0-1)
  - Angle threshold slider capsule (1-89 deg)
- `Stroke`
  - Width (pt)
  - Color source dropdown (Hub stroke / Black / First swatch)
- Action: `CONNECT` (primary)
- `Status`
  - Indicator dot
  - Status text
  - Footer note (Bring Hub to Front)

## Current UI Rules

- Tension number field allows up to 2 (extreme curl), the slider stays in 0-1 for ergonomics
- Angle threshold is integer 1-89 deg; values outside that break the four-quadrant routing
- Hub is always the front-most selected object, mirroring the original script
- Connection lines are sent to back to keep the hub and children visible
- Settings persist between sessions

## Iteration Log

### 2026-04-30

- Initial port from `O'Connect.jsx` (modal-less script) to a CEP panel
- Replaced hard-coded constants (TENSION 0.35, ANGLE_THRESHOLD 20, strokeWidth 2) with adjustable controls
- Added a Color source dropdown so users can choose between hub-derived stroke, plain black, or the first swatch
- Kept the four-sector edge-to-edge connection logic verbatim in the host
