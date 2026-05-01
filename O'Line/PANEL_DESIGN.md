# O'Line Panel Design

## Purpose

Tracks the UI design state of the O'Line CEP panel.

## Current Direction

- Dark CEP panel matching the O'Tool design system
- IDLE/ACTIVE state machine with live preview
- 14 topology algorithms in a categorised dropdown
- Per-topology parameter visibility (Logic section fields show only when relevant)
- Random seed cached: connections re-roll only when explicit NEW SEED button is pressed
- Bezier vs straight stroke rendering with bipolar tension control

## Current Structure

- `Topology` (lockable) — categorised custom dropdown
  - **Graph**: All to All, Chain, Loop, Step-Skip, Modular Skip, Random, Threshold Distance
  - **Radial**: Radial (Center), Star from Pivot
  - **Proximity**: Nearest Neighbors, K-Nearest Mutual
  - **Geometric**: Convex Hull, Minimum Spanning Tree, Delaunay Triangulation
- `Style` (lockable)
  - Bezier checkbox
  - Tension slider capsule (-400..+400, manual -800..+800), disabled when Bezier off
  - Stroke width
- `Logic` (lockable, dynamic)
  - Take / Neighbors — visible for: Step-Skip, Random, Nearest, K-Nearest Mutual
  - Skip — visible for: Step-Skip, Modular Skip
  - Distance — visible for: Threshold Distance
  - Section hidden when no field needed
- `Random Seed` (lockable, visible only for Random topology)
  - NEW SEED button
- `Action`
  - Primary morphs: LINE (idle) ↔ APPLY (active)
  - APPLY + CANCEL row in active
  - BAKE TO SYMBOL button in active
  - RESET PARAMETERS in active
- `Status`

## State machine

- **IDLE** — only LINE button active. All parameter panels dimmed.
- **LINE** click — collects anchor points (PathItem with 1 point: that point; PathItem with several: only points marked PathPointSelection.ANCHORPOINT; recurses through Groups and Compound paths). Needs ≥2. Builds `OLine_Preview` group with edges per topology. Transitions to ACTIVE.
- **ACTIVE** — every parameter change rebuilds the preview group's contents (clears + redraws).
- **APPLY** — detaches preview, leaves it as final result, returns to IDLE.
- **CANCEL** — removes preview, returns to IDLE.
- **BAKE TO SYMBOL** — converts the current preview to a Symbol named `OLine_<Bez|Lin>_<5-digit timestamp>`, removes the preview group, immediately rebuilds a fresh preview with the same config, stays in ACTIVE. Useful for cycling variations.

## Random seed behaviour

- Session caches a `randomSeed[i][k]` matrix where `seed[i][k]` is the target index for source point i, slot k.
- Re-rolled in full on: LINE click, NEW SEED button.
- Extended (without reshuffling existing entries) when Take grows.
- All other parameter changes (Topology change to/from random, Bezier, Tension, Stroke, Skip, Distance) reuse the cached seed.

## Iteration Log

### 2026-05-01

- Initial CEP port of O'Line v6.2 (6 original topologies).
- Added 8 new topologies: Loop, Modular Skip, Threshold Distance, Star from Pivot, K-Nearest Mutual, Convex Hull, Minimum Spanning Tree, Delaunay Triangulation. Total now 14.
- Convex Hull via gift-wrapping algorithm (O(nh)).
- MST via Prim's algorithm (O(n²) — fine for the typical anchor counts in design work).
- Delaunay via Bowyer-Watson incremental algorithm with super-triangle, circumcircle test using the standard determinant formula.
- Random seed cached with extend-on-Take-grow; explicit NEW SEED to re-roll.
- Tension control accepts both `-800..+800` (manual) and `-400..+400` (slider) — the wider manual range allows extreme cusps and overshoots.
- Anchor collection preserves the original v6.2 logic verbatim, including the single-point-path-uses-its-anchor special case.
