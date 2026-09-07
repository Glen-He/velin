# Relay

Relay is an Electron desktop client foundation built with React, Vite, TypeScript, and Oxlint.

## Development

```bash
pnpm install
pnpm dev
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm build
```

The renderer is a normal web environment. Electron main-process and preload code live in `electron/`, and the preload boundary is intentionally empty until a typed API is needed.
