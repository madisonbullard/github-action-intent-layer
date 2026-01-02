# AGENTS.md

## Build & Development

- Use `bun` for all commands (not npm/node/pnpm)
- TypeScript type check: `bun run tsc --noEmit` in package directories
- Run package entry point: `bun index.ts` in `packages/github-action/`
- Run tests: `bun test` in `packages/github-action/` (uses Bun's built-in test runner with Jest-like API)
- Root tsconfig.json uses JSONC (JSON with Comments) for Bun's recommended settings
- Package tsconfigs should extend `../../tsconfig.json` to inherit settings
