# O'Bevel Panel Design

## Purpose

Tracks the UI design state of the O'Bevel CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: Mode, mode-specific section, Radius, Action, Status
- Controls: 2-segment mode row, slider capsules, custom profile loader, Live Preview workflow
- Interaction: panel persists settings via localStorage; host keeps a session via `#targetengine "OBevelCEP"` so previews and the loaded clipboard profile survive across `evalScript` calls

## Current Structure

- `Mode`
  - Segmented buttons: STEPS / CUSTOM
- `Steps` (visible when mode = steps)
  - Count slider capsule (1-20 on slider, up to 50 manual)
- `Custom Profile` (visible when mode = custom)
  - LOAD CLIPBOARD button + status text
  - Flip vertical / Straight sides checkboxes
- `Radius`
  - Radius slider capsule (1-500 on slider, up to 5000 manual)
- `Action`
  - Live Preview checkbox
  - APPLY (primary) + CANCEL
  - RESET PARAMETERS
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- LOAD CLIPBOARD pastes the clipboard, parses the first encountered PathItem, normalises it to a unit-length axis, then deletes the temp paste. The profile lives in the host session and survives panel reloads
- STEPS mode generates stair-step bevels; CUSTOM mode tiles the loaded profile along each corner segment, with optional flip and straight-end cleanup
- Live Preview mirrors the original Corner Master: enabling captures every PathItem in the selection (groups and compound paths use their first path), hides originals, draws fresh preview paths next to each. APPLY removes originals and selects the previews. CANCEL or unchecking Live Preview removes previews and unhides originals
- Each preview update regenerates fresh paths (geometry differs drastically with Radius/Count/Mode), so caching is not used; the corner math is cheap enough for instant feedback
- When CUSTOM is active without a profile loaded, APPLY/preview are blocked with a clear status message

## Iteration Log

### 2026-05-01

- Initial port from `O'Bevel.jsx` (Corner Master v16) to a CEP panel
- Replaced the modal Window dialog with a persistent panel and CEP `evalScript` bridge
- Split parameters by mode (STEPS vs CUSTOM) using a segmented row + visibility toggles
- Reused the O'Bend session pattern (start/update/apply/cancel) and added `obevelLoadClipboard` to parse clipboard profiles
- Replaced the inline +/- buttons next to the radius input with the design-system slider capsule (number field still accepts arbitrary values up to 5000)
- Custom profile is stored in `obevelSession.customProfile`, so the same profile can be reused across multiple bevel sessions until reloaded
- The corner math (`calculateCornerPath`, `transform`, `rotateVec`, `parseClipboard`) is preserved verbatim from the original
