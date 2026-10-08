# UI Design Themes

This document records three available visual theme options for the Blood Donation Coordination System. These options are documented, not selected. Theme assignment remains OPEN for every screen in `ui-screen-map.md`; the user will choose each page's theme later. Recommendations may favor Mint Gauge for quantities/status, Sky Pipeline for processes, and Rose Quartz Focus for focused forms/actions, but those recommendations are not assignments.

## Mint Gauge

| Token / property | Value |
|---|---|
| Background | `#F1FAF6` |
| White surfaces | `#FFFFFF` |
| Alternate surface | `#E8F6F1` |
| Borders | `#DDEFE8`, `#C5E3D8` |
| Primary accent | `#2FA58A` |
| Strong buttons/links | `#1E8A71` |
| Primary tint | `#D5ECE4` |
| Secondary accent | `#7C93E8` |
| Main text | `#1F3A33` |
| Muted text | `#5C7A72` |
| Faint/decorative text | `#8FA89F` |
| Success | `#46B37E` |
| Warning | `#F2B84B`; dark text `#9A6B10`; tint `#FBEBC8` |
| Critical | `#E5636D`; dark text `#C0485A`; tint `#FDE8EA` |
| Fonts | Sora headings/numbers; Nunito Sans body/UI |
| Signature | Ring gauges, rounded cards, drawers, quiet status chips |
| Charts | Rounded bars, teal primary, periwinkle comparison, faint gridlines, donut cutout around 78% |
| Motion | Ring animation 600 ms, drawer 200 ms, subtle hover lift |

## Sky Pipeline

| Token / property | Value |
|---|---|
| Background | `#F3F9FF` |
| White surfaces | `#FFFFFF` |
| Alternate surface | `#E8F2FD` |
| Borders | `#D9E8F8`, `#BFD6F0` |
| Primary accent | `#3B8BEB` |
| Strong buttons/links | `#2F78D6` |
| Primary tint | `#D9E8F8` |
| Secondary accent | `#F7C948` |
| Secondary tint / border / text | `#FFF6D9` / `#F7DB85` / `#8A6A10` |
| Main text | `#1E3050` |
| Muted text | `#6B80A0` |
| Faint/decorative text | `#A9C4E6` |
| Success | `#3FB68B`; tint `#DDF5EC` |
| Warning | `#F2B84B` |
| Critical | `#E5636D`; dark text `#C0485A`; tint `#FDE8EA` |
| Fonts | Lexend headings/numbers; Mulish body/UI |
| Signature | Workflow stage tiles, tracks, step panels |
| Charts | Azure primary, yellow comparison/attention, rounded bars and light blue gridlines |
| Motion | Count-up numbers and 250 ms track transitions |

## Rose Quartz Focus

| Token / property | Value |
|---|---|
| Background | `#FFF6F7` |
| White surfaces | `#FFFFFF` |
| Alternate surface | `#FDEDEF` |
| Borders | `#F6DCE0`, `#EDC4CB` |
| Primary accent | `#E66A82` |
| Strong buttons/links | `#D4506A` |
| Primary tint | `#FBE0E5` |
| Secondary/success | `#3F7F5E` |
| Secondary mid / tint | `#8DBFA8` / `#E4F2EA` |
| Main text | `#3A2A30` |
| Muted decorative text | `#A58A92` |
| Small muted text | `#7E656D` |
| Warning | `#F2B84B`; dark text `#9A6B10`; tint `#FFF1D6` |
| Critical/emergency | `#C0485A`; tint `#FDE8EA` |
| Fonts | DM Serif Display headings/numbers; Karla body/UI |
| Signature | Focused task cards, serif numbers, calm forms |
| Charts | Rose primary, sage secondary, honey warnings, rounded bars and light gridlines |
| Motion | Subtle fade/rise, 60 ms stagger, gentle hover |

## Shared design requirements

- Keep shared navigation consistent across the application; do not move it to different screen edges because a theme changes.
- Use reusable semantic tokens and components.
- Support responsive layouts, visible keyboard focus, accessible labels/navigation, and contrast checks.
- Include loading, empty, success, and error states, and support reduced-motion preferences.
- Status and emergency meaning must never rely on color alone.
- Do not invent finalized inventory thresholds or dashboard metrics.
- Business rules override illustrative UI: allocation and issuing are separate actions; label allocated/reserved and issued quantities separately; `FULFILLED` requires all requested units to be issued; workflow tracks must reflect actual branches and cancellations rather than imply every request follows one linear sequence.

## Additional status and priority reference

These colors and treatments are source design references. They do not assign a theme to any screen, define operational thresholds, or replace the canonical status text. Preserve readable semantic foreground/tint combinations, and always include a text label or other non-color cue.

| Meaning | Mint Gauge | Sky Pipeline | Rose Quartz Focus |
|---|---|---|---|
| Emergency priority | `#E5636D` | `#E5636D` | `#C0485A` |
| Urgent priority | `#F2B84B` | `#F2B84B` | `#F2B84B` |
| Normal priority | `#5FBFA8` | `#3B8BEB` | `#8DBFA8` |
| Unit `AVAILABLE` | `#2FA58A` | `#3B8BEB` | `#E66A82` |
| Unit `ALLOCATED` | `#7C93E8` | `#F7C948` | `#F2B84B` |
| Unit `ISSUED` | `#5E8F83` | `#3FB68B` | `#3F7F5E` |
| Unit `EXPIRED` | `#E5636D` | `#E5636D` | `#C0485A` |
| Unit `DISCARDED` | `#B7C4BF` | `#B7C6DA` | `#CDBBC0` |
| Request `SUBMITTED` | `#8FA89F` | `#A9C4E6` | `#CDBBC0` |
| Request `UNDER_REVIEW` | `#7C93E8` | `#3B8BEB` | `#E66A82` |
| Request `AWAITING_INVENTORY` | `#F2B84B` | `#F7C948` | `#F2B84B` |
| Request `PARTIALLY_FULFILLED` | `#5FBFA8`, half-filled chip | `#3FB68B`, half-filled | `#8DBFA8`, half-filled |
| Request `FULFILLED` | `#2FA58A` | `#3FB68B` | `#3F7F5E` |
| Request `REJECTED` | `#E5636D` | `#E5636D` | `#C0485A` |
| Request `CANCELLED` | `#B7C4BF` | `#B7C6DA` | `#CDBBC0` |

## Typography and interaction reference

Values below are illustrative specifications for a selected theme, not page assignments. Apply reduced-motion preferences to every animation and verify foreground contrast independently of the status color.

| Theme | Type sizes and font details | Interaction and chart details |
|---|---|---|
| Mint Gauge | Page title 28–30 px; section title 20 px; card title 16 px; gauge numbers 20–24 px; body 13–14 px; captions 12 px. Sora number figures are tabular. | Ring first-load animation 600 ms ease-out; card hover lift 2 px; drawer 200 ms; status crossfade and quantity-ring fill. Rounded chart bars with `borderRadius` 8, faint y-grid, donut cutout 78%. Use strong button/link `#1E8A71` for small white text rather than relying on `#2FA58A`. |
| Sky Pipeline | Page title 28 px; stage numbers 40 px; card title 16 px; body 13–14 px; captions 12 px. | Count-up stage numbers; one chevron pulse when a count changes; track marker transition 250 ms; slight dock-icon hover lift; confirmation check. Rounded chart bars and faint blue grids; yellow tint is reserved for attention. Use strong button/link `#2F78D6`. |
| Rose Quartz Focus | Page title 42 px; key card numbers 52 px; brand 20 px; body 13–14 px; captions 12 px. Use `#7E656D` for small muted text; `#A58A92` is decorative/muted. | Cards fade/rise 8 px with 60 ms stagger; gentle hover with darker border; tooltip fade; chip crossfade; sage confirmation feedback. Rounded charts, light grids, serif chart titles, cream-center donuts. Emergency uses `#C0485A` plus a label, distinct from rose actions. |

Mint top pill tabs, Sky floating bottom dock, and Rose right icon rail are optional examples from the source reference, not three navigation prescriptions. Keep the same shared navigation placement and behavior across every theme. The final common navigation layout remains undecided.

Before each later screen/page design or implementation task, recommend a theme suited to that page's purpose and let the user choose. Apply the user's choice to that page. Until the user makes that choice, its assignment remains OPEN; every cell in `ui-screen-map.md` is currently OPEN.
