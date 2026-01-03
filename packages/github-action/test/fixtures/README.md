# Test Fixtures

This directory contains test fixtures representing various repository configurations for integration testing the intent layer GitHub Action.

## Directory Structure

```
fixtures/
├── no-intent-layer/          # Repository without any intent layer files
├── basic-agents/             # Repository with basic AGENTS.md structure
├── basic-claude/             # Repository with basic CLAUDE.md structure  
├── both-files/               # Repository with both AGENTS.md and CLAUDE.md
├── symlink-agents-source/    # AGENTS.md is source, CLAUDE.md is symlink
├── symlink-claude-source/    # CLAUDE.md is source, AGENTS.md is symlink
├── nested-hierarchy/         # Multi-level intent layer hierarchy
├── token-budget/             # Files for testing token budget calculations
└── pr-samples/               # Sample PR data (diffs, commits, issues)
```

## Usage

These fixtures are used by integration tests to simulate different repository states and configurations. Each fixture directory represents a complete mock repository structure.

### Mock Repository Structure

Each repository fixture follows this pattern:

```
fixture-name/
├── files.json                # File listing with content
├── tree.json                 # Git tree structure (for GitHub API mocking)
└── config.json               # Test configuration and expected results
```

### files.json Format

```json
{
  "path/to/file.ts": "file content here",
  "path/to/AGENTS.md": "# AGENTS.md content"
}
```

### tree.json Format (GitHub API compatible)

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
  ]
}
```

### config.json Format

```json
{
  "description": "Test case description",
  "expectedIntentFiles": ["AGENTS.md"],
  "expectedSymlinks": [],
  "configOverrides": {}
}
```
