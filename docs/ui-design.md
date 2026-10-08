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
