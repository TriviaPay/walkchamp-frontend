# Walk Champ — Frontend

Standalone Expo (React Native) mobile and web client.

## Setup

```bash
cd frontend
pnpm install
cp .env.example .env
```

## Scripts

```bash
pnpm dev          # Expo dev server
pnpm build        # Static web build (set EXPO_PUBLIC_WEB_URL)
pnpm serve        # Serve static web build
pnpm typecheck    # TypeScript check
```

## Mobile builds (EAS)

```bash
eas build --profile production
```

Set secrets in the [EAS dashboard](https://expo.dev).
