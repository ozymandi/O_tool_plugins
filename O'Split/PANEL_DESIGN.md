# O'Split Panel Design

## Purpose

Tracks the UI design state of the O'Split CEP panel.

## Current Direction

- Visual style: compact dark CEP panel matching the O'Tool design system
- Structure: a 2x2 grid of split actions, an options section, and a status footer
- Controls: four uppercase action buttons, a single checkbox for keep-original
- Interaction: each button triggers an immediate split using the current Keep Original toggle

## Current Structure

- `Split Text`
  - 2x2 grid: PARAGRAPHS / LINES / WORDS / CHARACTERS
- `Options`
  - Keep original (hide instead of delete)
- `Status`
  - Indicator dot
  - Status text
  - Footer note

## Current UI Rules

- All four split buttons share the same secondary visual weight; the user is choosing a mode, not a primary path
- During a host call, all four buttons are disabled simultaneously to prevent stacking jobs
- The Keep Original setting is persisted across sessions
- The host always uses the original "Relative Lift Isolation" technique to preserve manual kerning and prevent merging on touching letters
- Status reports the count of items created after each run

## Iteration Log

### 2026-04-30

- Initial port from `O'Split.jsx` palette window to a CEP panel
- Replaced the BridgeTalk dispatch with the standard CEP `evalScript` bridge
- Reused the relative-lift center detection and Earth-cluster scanner verbatim in the host
- Replaced the four-stack of buttons with a 2x2 grid for tighter use of horizontal space
- Removed the "Author" footer label and inline copyright; replaced with a status indicator and helper text
