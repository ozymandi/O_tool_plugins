# O'Fill Panel Design

## Purpose

Tracks the UI design state of the O'Fill CEP panel.

## Current Direction

- Visual style: dark CEP panel matching the O'Tool design system
- Two-state machine: IDLE → SELECT SHAPE → ACTIVE; ACTIVE → APPLY/CANCEL → IDLE
- Manual GENERATE — there is no live preview because the turbo-fill compute is too heavy for real-time feedback
- Stack-based donor management (key difference from the original O'Fill.jsx)

## Current Structure

- `Shape & Donors` (active-only)
  - Shape header with `Change` link
  - Stack list (drag-handle + name + delete X)
  - `+ ADD TO STACK` button
- `Geometry` (lockable)
  - Fill amount % slider capsule
  - Gap (px) slider capsule
  - Attempts (k) slider capsule
- `Scale` (lockable)
  - Min %, Max % paired number fields
- `Logic` (lockable)
  - Origin 2x2 segmented grid (BOTTOM UP / TOP DOWN / LEFT→RIGHT / RIGHT→LEFT)
  - MIX checkbox
- `Output` (lockable)
  - Random rotation, Clipping mask checkboxes
- `Action`
  - Primary morphs: SELECT SHAPE (idle) ↔ GENERATE (active)
  - APPLY (active, enabled when preview exists) + CANCEL (active)
  - RESET PARAMETERS (active)
- `Status`

## State machine

- **IDLE** — only the primary `SELECT SHAPE` button is enabled. All parameter panels and the Shape & Donors section are dimmed/hidden.
- **SELECT SHAPE click** → captures `selection[0]` as the container, clears the stack, transitions to ACTIVE.
- **ACTIVE**
  - `+ ADD TO STACK` — appends every currently selected artboard item to the donor stack. Each item is converted to a SymbolItem on add (or reused if it already is one). Adding does NOT clear the existing preview.
  - Stack rows can be dragged to reorder (HTML5 native DnD via the drag handle) or removed via the X button.
  - `GENERATE` (primary) — drops the previous preview group, runs turbo-fill with the current config, places the new preview group on the active layer. Repeat as often as desired.
  - `APPLY` — enabled only when a preview exists. Optionally adds the clipping mask (via container.duplicate at the start of the preview group + clipped=true). Clears the session and returns to IDLE. The preview group remains as the final result.
  - `CANCEL` — drops the preview group and clears the session entirely (container, stack, params stay in localStorage). Returns to IDLE.

## Current UI Rules

- The container must be a single item; multi-selection is rejected.
- Donors converted to symbols are kept in `app.activeDocument.symbols`. The plugin does not delete those symbols on cancel — they remain in the document for further reuse.
- Stack order maps to the donor index used by the gradient distribution. Reordering changes which donor lands where in non-MIX modes.
- Adding to the stack while a preview exists keeps the stale preview visible — the user must press GENERATE for the new stack to take effect.
- Changing the shape (via the `Change` link) drops the current preview because the geometry no longer matches.
- The Attempts slider tops out at 100k on the slider but the number field accepts up to 500k for power users; over 100k may stall Illustrator.

## Iteration Log

### 2026-05-01

- Initial CEP port of `O'Fill.jsx` v9 (Turbo grid fill).
- Replaced the original Preview/OK/Cancel modal with a stack-based session: SELECT SHAPE → +ADD TO STACK → GENERATE → APPLY/CANCEL.
- Stack supports drag-to-reorder (HTML5 DnD) and per-row delete; no live preview by design.
- Donor → Symbol conversion happens on +ADD TO STACK so subsequent generations are fast (no re-conversion).
- Preview group is named `OFILL_PREVIEW_FINAL` and is recreated on every GENERATE; the host keeps a direct ref plus a getByName fallback for cleanup.
- Turbo math (calculateTurbo, isPointInPoly, checkGridCollision, shrink-on-collision) is preserved verbatim from the original.
