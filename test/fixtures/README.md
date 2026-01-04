# Test Fixtures

This directory contains test fixtures representing various repository configurations for integration testing the intent layer GitHub Action.

## Directory Structure

```
fixtures/
├── no-intent-layer/          # Repository without any intent layer files
├── basic-agents/             # Repository with basic AGENTS.md structure
├── symlink-agents-source/    # AGENTS.md is source, CLAUDE.md is symlink
├── symlink-claude-source/    # CLAUDE.md is source, AGENTS.md is symlink
├── nested-hierarchy/         # Multi-level intent layer hierarchy
├── index.ts                  # Fixture loader utilities
└── README.md                 # This file
```

## Fixture Descriptions

### no-intent-layer
Repository without any intent layer files. Tests initialization suggestion behavior when no AGENTS.md or CLAUDE.md exists.

### basic-agents
Repository with basic AGENTS.md at root. Tests update existing node behavior and detection of existing intent layer.

### symlink-agents-source
Repository with AGENTS.md as the source file and CLAUDE.md as a symlink pointing to AGENTS.md. Tests symlink detection and handling.

### symlink-claude-source
Repository with CLAUDE.md as the source file and AGENTS.md as a symlink pointing to CLAUDE.md. Tests symlink detection with reversed source/target.

### nested-hierarchy
Multi-package monorepo with nested intent layer hierarchy. Contains root AGENTS.md plus package-level AGENTS.md files in `packages/api/` and `packages/core/`. Tests hierarchy traversal and node coverage.

## Usage

Import fixture utilities from `index.ts`:

```typescript
import { loadFixture, listFixtures, createFixtureMocks } from "./fixtures";

// List all available fixtures
const fixtures = listFixtures();

// Load a specific fixture
const fixture = loadFixture("basic-agents");

// Create mock GitHub API responses
const mocks = createFixtureMocks(fixture);
```

## Fixture File Structure

Each fixture directory contains three required files:

```
fixture-name/
├── files.json    # File paths mapped to content
├── tree.json     # GitHub API tree structure
└── config.json   # Test configuration and expected results
```

### files.json Format

Maps file paths to their content:

```json
{
  "path/to/file.ts": "file content here",
  "AGENTS.md": "# AGENTS.md content"
}
```

### tree.json Format

GitHub API-compatible tree structure:

```json
{
  "sha": "tree-sha-123",
  "tree": [
    {
      "path": "path/to/file",
      "mode": "100644",
      "type": "blob",
      "sha": "blob-sha"
    }
  ],
  "symlinkTargets": {
    "symlink-sha": "target-path"
  }
}
```

Note: `mode: "120000"` indicates a symlink. The `symlinkTargets` map provides the target path for each symlink SHA.

### config.json Format

Test configuration with expected results:

```json
{
  "description": "Test case description",
  "expectedIntentFiles": ["AGENTS.md"],
  "expectedSymlinks": [
    { "source": "AGENTS.md", "target": "CLAUDE.md" }
  ],
  "expectedBehavior": {
    "shouldSuggestRootAgentsMd": false,
    "shouldSuggestHierarchy": false,
    "canUpdateExistingNode": true,
    "symlinkSource": "agents",
    "shouldDetectSymlink": true
  },
  "expectedHierarchy": {
    "roots": ["AGENTS.md"],
    "children": { "AGENTS.md": ["packages/api/AGENTS.md"] }
  },
  "expectedCoverage": {
    "AGENTS.md": ["README.md", "package.json"]
  },
  "configOverrides": {}
}
```
