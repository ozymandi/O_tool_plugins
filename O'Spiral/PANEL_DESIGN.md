# O'Spiral Panel Design

## Purpose

Tracks the UI design state of the O'Spiral CEP panel.

## Current Direction

- Dark CEP panel matching the O'Tool design system
- IDLE/ACTIVE state machine with live preview
- Single preview PathItem mutated in place; geometry is recomputed on every parameter change
- Noise re-rolls on each rebuild — same behaviour as the original Preview button

## Current Structure

- `Loop Mode` (lockable) — segmented TOTAL / PER SEGMENT
- `Loops` (lockable) — slider capsule for loop count (slider 1–200, manual to 1000)
- `Randomness` (lockable) — slider capsule 0–100, controls per-loop noise envelope
- `Direction` (lockable) — segmented CW / CCW
- `Action`
  - IDLE: primary `SPIRAL` button only
  - ACTIVE: primary `APPLY` (commits) + `CANCEL` (reverts) + `RESET PARAMETERS`
- `Status` — indicator dot + text + footer note

## State machine

- **IDLE** — only SPIRAL button is active, parameters dimmed.
- **SPIRAL** click — selection (≥2 circles) is sorted top-down then left-to-right with a 10pt vertical tolerance, key bounds are stored in the host session, an initial preview path is created. Transitions to ACTIVE.
- **ACTIVE** — every parameter change rebuilds the preview path's points (mutates the same PathItem; no add/remove churn).
- **APPLY** — detaches the preview path from the session, leaves it as final result. Returns to IDLE.
- **CANCEL** — removes the preview path and returns to IDLE.

## Current UI Rules

- Stroke color is inherited from the first sorted circle (or pure black if it has no stroke).
- Noise envelope re-rolls on each rebuild — matches the original Preview semantics. To find a particular pattern, lock parameters and CANCEL → SPIRAL again, or stay at randomness=0 for deterministic output.
- TOTAL loops mode treats the loop count as the spiral total. PER SEGMENT multiplies it by the number of segments between consecutive key circles.
- Slider tops at 200 loops; the number field accepts up to 1000 for power users (proceed at your own performance risk).

## Iteration Log

### 2026-05-01

- Initial CEP port of `O'Spiral.jsx`.
- Replaced the Preview/Confirm/Cancel modal with the IDLE/ACTIVE state machine and live preview.
- Spiral PathItem points are mutated in place via `pathPoints.add()` / `.remove()` length adjustment + per-point anchor updates — avoids creating/destroying the path on every drag.
- Sorting (top-down, left-to-right with 10pt tolerance), Catmull-Rom-style spline, noise envelope with `sin(πt)` keyframe constraint, and CW/CCW direction logic are preserved verbatim from the original.
