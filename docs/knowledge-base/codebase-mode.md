# Codebase Mode — CLI Usage Examples

## `discover` — Analyze project structure

```bash
# Basic discovery on default path (src/)
bun start discover

# Discover a specific directory
bun start discover ./packages/api

# Pipe to a file
bun start discover > project-analysis.txt
```

Example output:

```
## Codebase Discovery Results
- Framework: express
- Total entities found: 42
- Functions: 38
- Classes: 4
- Exports: 35
- API endpoints detected: 12
- Entry points: src/index.ts
```

## `coverage` — Detect test coverage gaps

```bash
# Scan coverage for default path
bun start coverage

# Scan coverage for a specific project
bun start coverage ./apps/backend/src
```

## `analyze` — Deep-dive on a specific entity

```bash
# Analyze a function
bun start analyze getUser

# Analyze a class
bun start analyze UserService

# Include file path for disambiguation
bun start analyze src/services/user.ts:getUser
```

## `generate --existing` — Generate & merge tests

```bash
# Generate tests for existing codebase (no spec file)
bun start generate --existing

# Dry-run: preview what would be generated
bun start generate --existing --dry-run

# Override discovery path
bun start generate --existing --discovery-path ./packages/api/src

# Custom output directory
bun start generate --existing --out-dir ./tests/codebase

# Separate augmentation files (don't modify originals)
bun start generate --existing --augment-strategy separate

# Append-only (no smart merge)
bun start generate --existing --augment-strategy append
```

## Programmatic API

See `examples/codebase-mode.ts` for a full runnable example.
