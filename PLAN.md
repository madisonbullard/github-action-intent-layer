# PLAN.md

## Overview

**github-action-intent-layer** is a GitHub Action that automatically maintains a repository's "Intent Layer" — hierarchical `AGENTS.md` and/or `CLAUDE.md` files that provide AI agents with compressed, high-signal context about the codebase.

The action runs on PRs (open, sync, edit), analyzes code changes, and suggests updates to intent nodes via PR comments with approval checkboxes. It follows the "Ralph Driven Development" methodology: plan thoroughly, execute in loops, capture learnings.

**Prerequisites**: User must provide an LLM API key (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`) as a repository secret.

### References

- **Intent Layer concept**: https://www.intent-systems.com/learn/intent-layer
- **Ralph Driven Development methodology**: https://lukeparker.dev/stop-chatting-with-ai-start-loops-ralph-driven-development
- **OpenCode SDK**: https://opencode.ai/docs/sdk/
- **OpenCode Custom Tools**: https://opencode.ai/docs/custom-tools/
- **OpenCode Config**: https://opencode.ai/docs/config/
- **OpenCode Github App source**: https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/github/index.ts

---

## Project Structure

```
packages/github-action/
├── action.yml                    # GitHub Action definition
├── package.json                  # Bun package
├── tsconfig.json
├── src/
│   ├── index.ts                  # Entry point (routes to analyze or checkbox-handler)
│   ├── config/
│   │   ├── schema.ts             # Zod schema for action inputs
│   │   └── defaults.ts           # Default configuration values
│   ├── github/
│   │   ├── client.ts             # GitHub API wrapper (uses GITHUB_TOKEN)
│   │   ├── comments.ts           # PR comment management
│   │   ├── commits.ts            # Commit operations (intent commits)
│   │   └── context.ts            # Extract PR context (diff, commits, issues, etc.)
│   ├── intent/
│   │   ├── detector.ts           # Detect existing intent layer structure
│   │   ├── analyzer.ts           # Analyze which nodes need updates
│   │   ├── tokenizer.ts          # Approximate token counting for budget enforcement
│   │   ├── hierarchy.ts          # Build/traverse intent node hierarchy
│   │   └── generator.ts          # Generate updated MD content via OpenCode SDK
│   ├── opencode/
│   │   ├── client.ts             # OpenCode SDK wrapper
│   │   ├── session.ts            # Session management
│   │   └── prompts.ts            # LLM prompts for intent layer analysis
│   ├── patterns/
│   │   ├── ignore.ts             # .intentlayerignore parsing
│   │   └── prompts.ts            # Pattern-matched prompt resolution
│   └── utils/
│       ├── files.ts              # File system utilities
│       ├── symlink.ts            # Symlink detection and management
│       └── diff.ts               # Diff formatting utilities
├── test/
│   ├── unit/                     # Unit tests with mocked GitHub API
│   ├── integration/              # Integration tests against test repo
│   └── fixtures/                 # Test fixtures (sample repos, PRs)
└── README.md
```

Root-level additions:
```
.github/
└── workflows/
    ├── ci.yml                    # Run tests on PRs
    └── release.yml               # Release on main branch
```

---

## Action Inputs

```yaml
inputs:
  mode:
    description: 'Operation mode: analyze | checkbox-handler'
    required: false
    default: 'analyze'

  model:
    description: 'Model to use (provider/model format)'
    required: false
    default: 'anthropic/claude-sonnet-4-20250514'

  files:
    description: 'Which files to manage: agents | claude | both'
    required: false
    default: 'agents'

  symlink:
    description: 'Create symlinks between AGENTS.md and CLAUDE.md: true | false'
    required: false
    default: 'false'

  symlink_source:
    description: 'Which file is source of truth when symlinking: agents | claude'
    required: false
    default: 'agents'

  output:
    description: 'Output mode: pr_comments | pr_commit | new_pr'
    required: false
    default: 'pr_comments'

  new_nodes:
    description: 'Allow new node creation: true | false'
    required: false
    default: 'true'

  split_large_nodes:
    description: 'Automatically suggest splitting large nodes'
    required: false
    default: 'true'

  token_budget_percent:
    description: 'Max token budget as percentage of covered code'
    required: false
    default: '5'

  skip_binary_files:
    description: 'Skip token counting for binary files: true | false'
    required: false
    default: 'true'

  file_max_lines:
    description: 'Skip token counting for files exceeding this many lines'
    required: false
    default: '8000'

  prompts:
    description: 'Pattern-matched custom prompts (YAML string)'
    required: false
    default: ''
```

### Mode Descriptions

| Mode | Trigger | Description |
|------|---------|-------------|
| `analyze` | `pull_request: opened, synchronize, edited` | Runs LLM analysis, then acts based on `output` (`pr_comments`, `pr_commit`, or `new_pr`) |
| `checkbox-handler` | `issue_comment: created, edited` | Handles checkbox toggles for `output: pr_comments` comments, commits or reverts intent changes (with 1.5s debounce) |

### Prompts Input Structure

```yaml
prompts:
  - pattern: "**/*"
    prompt: "General guidance for all files..."
  - pattern: "packages/api/**"
    agents_prompt: "API-specific guidance for AGENTS.md..."
    claude_prompt: "API-specific guidance for CLAUDE.md..."
  - pattern: "**/*.test.ts"
    prompt: "Test files should not have their own intent nodes..."
```

---

## Task Backlog

### Phase 1: Project Setup
- [x] 1.1 Create `packages/github-action/` directory
- [x] 1.2 Initialize Bun package (`bun init`)
- [ ] 1.3 Configure TypeScript (ESM, strict mode)
- [ ] 1.4 Configure ESLint, Prettier (extend root config)
- [ ] 1.5 Add package to root workspace
- [ ] 1.6 Create `action.yml` with all inputs defined
- [ ] 1.7 Set up esbuild for bundling
- [ ] 1.8 Set up Vitest for testing

### Phase 2: Configuration & Parsing
- [ ] 2.1 Define Zod schema for all action inputs (including `mode`)
- [ ] 2.2 Implement root `.intentlayerignore` parser (gitignore syntax)
- [ ] 2.3 Implement pattern-matched prompt resolver
- [ ] 2.4 Implement config validation and defaults
- [ ] 2.5 Write unit tests for config parsing

### Phase 3: GitHub Context Extraction
- [ ] 3.1 Create GitHub API client wrapper (uses repo's `GITHUB_TOKEN`)
- [ ] 3.2 Extract PR metadata (title, description, labels)
- [ ] 3.3 Extract all commits on branch with messages
- [ ] 3.4 Extract linked issues (parse `Fixes #123`, `Closes #456`)
- [ ] 3.5 Extract review comments on PR
- [ ] 3.6 Extract code diff (files changed, additions, deletions)
- [ ] 3.7 Write unit tests with mocked GitHub API responses

### Phase 4: Intent Layer Detection
- [ ] 4.1 Detect existing `AGENTS.md` files in repo
- [ ] 4.2 Detect existing `CLAUDE.md` files in repo
- [ ] 4.3 Detect symlink relationships between files
- [ ] 4.4 Build hierarchy tree of existing intent nodes
- [ ] 4.5 Validate symlink config (error if conflict: both files exist, not symlinked, `symlink: true`)
- [ ] 4.6 Write unit tests for detection logic

### Phase 5: Token Budget & Analysis
- [ ] 5.1 Implement approximate token counter (simple heuristic, not model-specific)
- [ ] 5.2 Calculate "covered files" for each intent node (nearest parent, excludes `.intentlayerignore` files)
- [ ] 5.3 Calculate token count of covered code per node
- [ ] 5.4 Calculate current token budget usage per node
- [ ] 5.5 Identify nodes exceeding budget threshold
- [ ] 5.6 Identify nodes that should be split
- [ ] 5.7 Write unit tests for token calculations

### Phase 6: Change Analysis
- [ ] 6.1 Map changed files to their covering intent nodes
- [ ] 6.2 Determine which nodes need updates based on diff (nearest covering node only)
- [ ] 6.3 Review parent nodes for updates (default to no parent changes unless clearly needed)
- [ ] 6.4 Identify potential new semantic boundaries (respects `new_nodes: false`)
- [ ] 6.5 Generate "update reasons" for each affected node
- [ ] 6.6 Write unit tests for change analysis

### Phase 7: OpenCode SDK Integration
- [ ] 7.1 Define and validate structured JSON output schema
- [ ] 7.2 Update prompts to elicit valid JSON output
- [ ] 7.3 Initialize OpenCode SDK client with user-provided API key
- [ ] 7.4 Create session for intent layer analysis
- [ ] 7.5 Build context payload (PR info, commits, issues, diff, existing nodes)
- [ ] 7.6 Implement prompt for updating existing nodes
- [ ] 7.7 Implement prompt for proposing new nodes (skip if `new_nodes: false`)
- [ ] 7.8 Implement prompt for suggesting node splits
- [ ] 7.9 Apply pattern-matched custom prompts
- [ ] 7.10 Parse and schema-validate structured JSON output from stdout
- [ ] 7.11 Handle model access errors (fail action with clear message)

### Phase 8: PR Comment Management
- [ ] 8.1 Generate diff format (before/after) for each node update
- [ ] 8.2 Create comment template with hidden marker `<!-- INTENT_LAYER node=path/to/AGENTS.md otherNode=path/to/CLAUDE.md appliedCommit=<sha> headSha=<sha> -->`
- [ ] 8.3 Create comment template with single checkbox for approval (`- [ ] Apply this change`)
- [ ] 8.4 Post one comment per affected node
- [ ] 8.5 Find existing comments by hidden marker on subsequent runs
- [ ] 8.6 Mark old comments as `**RESOLVED**`, post new comments
- [ ] 8.7 Write unit tests for comment formatting

### Phase 9: Commit Operations
- [ ] 9.1 Implement `[INTENT:ADD]` commit creation
- [ ] 9.2 Implement `[INTENT:UPDATE]` commit creation
- [ ] 9.3 Implement `[INTENT:REVERT]` commit (file-level revert: restore file to pre-commit state using `appliedCommit` parent)
- [ ] 9.4 Handle symlink creation in commits (create both files, one as symlink, respects `symlink_source`)
- [ ] 9.5 Write unit tests for commit operations

### Phase 10: Checkbox Toggle Handler (`mode: checkbox-handler`)
- [ ] 10.1 Implement 1.5s debounce (wait, re-fetch comment, verify state unchanged)
- [ ] 10.2 Detect checkbox state in comment body (single checkbox per comment)
- [ ] 10.2a If unchecked and no `appliedCommit`, do nothing
- [ ] 10.3 Parse node path + `appliedCommit` + `headSha` from hidden marker
- [ ] 10.4 If checked: ensure current PR `headSha` matches marker `headSha`, then create intent commit (`[INTENT:ADD]` or `[INTENT:UPDATE]`) and update marker `appliedCommit`
- [ ] 10.5 If unchecked: if no `appliedCommit`, do nothing; otherwise perform file-level revert (restore file to pre-commit state)
- [ ] 10.6 Update comment to reflect new state (committed/reverted)
- [ ] 10.7 Write unit tests for checkbox handler

### Phase 11: PR Output Mode (`output: new_pr`)
- [ ] 11.1 Create separate branch for intent updates (`intent-layer/<pr-number>`)
- [ ] 11.2 Apply all suggested changes to branch (no approval checkboxes needed)
- [ ] 11.3 Open PR targeting original PR's branch
- [ ] 11.4 Post a single comment on original PR linking to intent layer PR

### Phase 12: Edge Cases & Error Handling
- [ ] 12.1 Handle no intent layer exists → suggest creating root `AGENTS.md` only
- [ ] 12.2 Handle symlink conflict → fail action with clear error message
- [ ] 12.3 Handle very large PRs: skip action entirely if PR exceeds 100k lines changed
- [ ] 12.4 Handle API rate limits (retry with backoff)
- [ ] 12.5 Handle model access errors → fail action with clear error message (no PR comment)
- [ ] 12.6 Fail checkbox-handler if history is insufficient (requires `fetch-depth: 0`)
- [ ] 12.7 Ensure action fails cleanly with informative error messages
- [ ] 12.8 Fail action if `symlink: true` on Windows (unsupported platform)

### Phase 13: Integration Testing
- [ ] 13.1 Create test repository with various intent layer configs
- [ ] 13.2 Integration test: no intent layer → initialization suggestion
- [ ] 13.3 Integration test: update existing node
- [ ] 13.4 Integration test: propose new node (`new_nodes: true`)
- [ ] 13.5 Integration test: checkbox toggle → commit
- [ ] 13.6 Integration test: checkbox untoggle → revert
- [ ] 13.7 Integration test: symlink handling (both directions)
- [ ] 13.8 Integration test: token budget enforcement (binary/large file skipping)
- [ ] 13.9 Integration test: `output: new_pr` mode

### Phase 14: CI/CD & Release
- [ ] 14.1 Create CI workflow (`ci.yml`) - run tests on PR
- [ ] 14.2 Create release workflow (`release.yml`) - version, tag, release on main
- [ ] 14.3 Set up semantic versioning
- [ ] 14.4 Configure GitHub Action marketplace metadata

### Phase 15: Documentation
- [ ] 15.1 Write comprehensive README with examples
- [ ] 15.2 Document all action inputs (including `mode`)
- [ ] 15.3 Document `.intentlayerignore` format
- [ ] 15.4 Document prompts configuration
- [ ] 15.5 Add troubleshooting guide
- [ ] 15.6 Create example workflows for common use cases

---

## Key Design Decisions

### 1. One Comment Per Node
Each intent node gets its own PR comment. This allows:
- Granular approval (single checkbox per node)
- Clear diff visibility
- Independent resolution tracking

### 2. Commit Message Conventions
```
[INTENT:ADD] path/to/AGENTS.md - Description
[INTENT:UPDATE] path/to/AGENTS.md - Description
[INTENT:REVERT] path/to/AGENTS.md - Description
```

When `output: pr_commit`, all proposed changes are committed in a single commit with message:
```
[INTENT] apply intent layer updates
```

Reverts are performed via `git revert` using the exact commit hash stored in the comment marker (no git log search required).

### 3. Token Budget Enforcement
```
Budget % = (node_tokens / covered_code_tokens) * 100
```
- Default threshold: 5%
- Exceeding budget triggers split suggestion
- "Covered code" = all files where this node is the nearest parent intent file
- Files matching `.intentlayerignore` are excluded from both update triggers AND token calculations
- Token counting uses `chars / 4` heuristic (approximate, not model-specific)
- Binary files can be skipped (`skip_binary_files: true`)
- Very large files are skipped when they exceed `file_max_lines` (default: 8000)

### 4. Symlink Strategy
- `symlink: true | false` (explicit)
- `symlink_source: agents | claude` (which file is source of truth, default `agents`)
- Symlinks are real filesystem symlinks committed to git
- If `symlink: false` but `AGENTS.md`/`CLAUDE.md` are symlinked → fail action with clear error
- **Unix only**: If `symlink: true` on Windows, fail action with clear error (Windows symlinks require elevated permissions)

### 5. Error Handling
Model access errors and other critical failures cause the action to fail with clear error messages. No PR comments for errors.

### 6. Single Action, Two Modes
Both workflows (analyze and checkbox-handler) use the same action with `mode` input:
- `mode: analyze` (default) — PR analysis, comment posting
- `mode: checkbox-handler` — checkbox toggle handling, commit/revert

### 7. Comment Tracking
Comments include a hidden HTML marker for identification:
```html
<!-- INTENT_LAYER node=path/to/AGENTS.md otherNode=path/to/CLAUDE.md appliedCommit=<sha> headSha=<sha> -->
```
This enables:
- Finding existing comments on subsequent runs
- Parsing node path in checkbox handler

### 8. Comment Resolution on Re-runs
On subsequent runs (PR updates), the action:
- Marks old comments as `**RESOLVED**`
- Posts new comments with updated suggestions
- Does NOT edit old comments in-place with new content

### 9. Pattern-Matched Prompts Precedence
When multiple patterns match a file, the **most specific pattern wins** (no merging). Specificity is determined by path depth and glob narrowness.

### 10. New Node Behavior
| `new_nodes` value | Behavior |
|-------------------|----------|
| `true` | Allow proposing/creating new nodes |
| `false` | Never suggest or create new nodes |

New nodes are always proposed in `output: pr_comments` (created only when approved).

### 11. Output Modes
| `output` value | Behavior |
|----------------|----------|
| `pr_comments` | Post per-node comments on PR with a single checkbox for approval |
| `pr_commit` | Apply all proposed changes immediately in a single commit (no approval) |
| `new_pr` | Open a new PR with all proposed changes and leave a single link comment on the original PR |

### 12. Authentication
- **GitHub API**: Uses repository's `GITHUB_TOKEN` (standard Actions token)
- **LLM/OpenCode**: User provides API key as secret (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`) — only required for `mode: analyze`, not for `mode: checkbox-handler`
- OpenRouter allows access to multiple model providers through a single API key

### 13. OpenCode Integration
- Uses `@opencode-ai/sdk` for programmatic session control
- LLM outputs structured JSON to stdout, which the action schema-validates
- No dependency on OpenCode GitHub App

### 14. Checkbox Debounce
Checkbox handler implements 1.5s debounce:
1. Wait 1.5 seconds after event
2. Re-fetch comment to verify checkbox state unchanged
3. Only proceed if state is stable

Checkbox handler enforces that the current PR `headSha` matches the `headSha` stored in the comment marker before applying changes. If `headSha` doesn't match, the comment is marked as `**RESOLVED**` (stale suggestion).

### 15. Hierarchical Update Strategy
- Updates target the nearest covering intent node only
- When a node is added/edited, parent nodes are reviewed for updates, but the prompt should default to making no parent changes unless clearly needed
- No `max_depth` limit

### 16. Initial State
When no intent layer exists:
- Only suggest creating root `AGENTS.md`
- Do not propose full hierarchy structure

### 17. Large PR Handling
PRs exceeding **100,000 lines changed** are skipped entirely. The action exits early with an informational message (not a failure).

### 18. Revert Strategy
When a checkbox is unchecked, use **file-level revert** (restore the specific intent file to its pre-commit state) rather than `git revert`. This prevents unintended side effects when multiple intent changes have been applied in sequence.

---

## Dependencies

```json
{
  "dependencies": {
    "@actions/core": "^1.10.0",
    "@actions/github": "^6.0.0",
    "@opencode-ai/sdk": "latest",
    "zod": "^3.22.0",
    "ignore": "^5.3.0",
    "minimatch": "^9.0.0",
    "diff": "^5.1.0",
    "yaml": "^2.3.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.19.0"
  }
}
```

---

## Structured Output

The LLM produces structured JSON (to stdout) describing all proposed intent layer changes. The action validates this JSON against a schema and then proceeds according to `output`.

Proposed shape:
```json
{
  "updates": [
    {
      "nodePath": "path/to/AGENTS.md",
      "otherNodePath": "path/to/CLAUDE.md",
      "action": "create | update | delete",
      "reason": "Why this change is needed",
      "currentContent": "(optional, required for update/delete)",
      "suggestedContent": "(required for create/update, omit for delete)"
    }
  ]
}
```

Notes:
- `action` must be one of: `create`, `update`, `delete`
- "Split" operations are modeled as an `update` to the existing node + a `create` for the new child node
- `otherNodePath` is only populated when both AGENTS.md and CLAUDE.md exist (based on `files` config)

---

## Workflow Examples

### Main Intent Layer Workflow (for consuming repos)
```yaml
name: intent-layer
on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  update-intent-layer:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/github-action-intent-layer@v1
        with:
          mode: analyze
          output: pr_comments
          model: anthropic/claude-sonnet-4-20250514
          files: agents
          token_budget_percent: 5
          new_nodes: true
          skip_binary_files: true
          file_max_lines: 8000
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Main Intent Layer Workflow with OpenRouter (for consuming repos)
```yaml
name: intent-layer
on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  update-intent-layer:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/github-action-intent-layer@v1
        with:
          mode: analyze
          output: pr_comments
          model: openrouter/anthropic/claude-sonnet-4-20250514
          files: agents
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

### Checkbox Handler Workflow (for consuming repos)
```yaml
name: intent-layer-checkbox
on:
  issue_comment:
    types: [created, edited]

jobs:
  handle-checkbox:
    if: contains(github.event.comment.body, '<!-- INTENT_LAYER')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required: checkbox handler needs full history for file-level reverts
      - uses: your-org/github-action-intent-layer@v1
        with:
          mode: checkbox-handler
        # Note: No LLM API key required for checkbox-handler mode
```

### PR Commit Output Mode (for consuming repos)
```yaml
name: intent-layer
on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  update-intent-layer:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/github-action-intent-layer@v1
        with:
          mode: analyze
          output: pr_commit
          new_nodes: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### New PR Output Mode (for consuming repos)
```yaml
name: intent-layer
on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  update-intent-layer:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/github-action-intent-layer@v1
        with:
          mode: analyze
          output: new_pr
          new_nodes: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```
