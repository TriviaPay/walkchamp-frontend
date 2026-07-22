# Onboarding PNG asset compression

Date: 2026-07-22

## Scope

Lossless/visually lossless compression of onboarding illustrations in `assets/images/onboarding/`. Filenames unchanged; no code or layout reference updates.

## Method

- Tool: `sharp` (temporary, not committed as a dependency)
- Strategy: indexed PNG palette at quality 100, zlib compression level 9, effort 10, dither 0; metadata stripped
- Dimensions kept at **1024x1024**
- Alpha / 4-channel RGBA preserved (automated check)

Candidates compared per file: max zlib lossless vs palette@100 vs palette@95. Smallest valid output (same size + alpha) chosen; all six used **palette100**.

## Automated checks

| Check | Result |
|-------|--------|
| Width x height | 1024x1024 for all six |
| `hasAlpha` | `true` for all six |
| Channels | 4 (RGBA) for all six |
| Filenames | unchanged |

**Visual comparison:** pending manual review in the app / design tools. Palette quantization is visually lossless for these flat/illustration-style assets at quality 100, but spot-check edges and gradients on device.

## Size results

| File | Original (bytes) | Optimized (bytes) | Reduction |
|------|-----------------:|------------------:|----------:|
| completion-screen.png | 1,807,115 | 217,372 | 88.0% |
| health-connect.png | 1,658,774 | 154,856 | 90.7% |
| how-it-works.png | 1,674,331 | 175,346 | 89.5% |
| notifications.png | 1,577,216 | 153,476 | 90.3% |
| step-goal.png | 1,755,256 | 178,711 | 89.8% |
| welcome.png | 1,610,354 | 125,352 | 92.2% |
| **Total** | **10,083,046** | **1,005,113** | **90.0%** |

Original ~9.6 MB -> optimized ~0.96 MB.
