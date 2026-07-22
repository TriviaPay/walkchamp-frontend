# UI Regression Checklist

Date: 2026-07-22  
Status: **PENDING (not run)** — no baseline/post-change screenshots were captured in this hardening pass.

Hardening changes were constrained to preserve layout. Still required before claiming production readiness:

## Screens to capture (baseline vs post-change)

- Walk
- Live tab
- Live Detail Race Track
- Live Detail Live Board
- Chat
- Wallet
- Waiting Room
- Available Rooms
- Challenge creation
- Profile
- Onboarding
- Authentication

## Devices / conditions

- Small Android
- Standard Android
- Large Android
- Notched iPhone
- Large accessibility font
- Keyboard open where applicable

## Compare

- Position, spacing, fonts, card/button dimensions
- Safe areas, bottom navigation, modals
- Scroll behavior
- Onboarding image rendering (after PNG compression)

Any unintended visual difference must be reverted.
