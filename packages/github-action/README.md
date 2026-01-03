# Intent Layer GitHub Action

Automatically maintain your repository's [Intent Layer](https://www.intent-systems.com/learn/intent-layer) - hierarchical `AGENTS.md` and/or `CLAUDE.md` files that provide AI agents with compressed, high-signal context about your codebase.

## What is the Intent Layer?

The Intent Layer is a hierarchical system of context files (`AGENTS.md`, `CLAUDE.md`) placed throughout your codebase. These files help AI agents understand your code the way your best engineers do - knowing the boundaries, invariants, and patterns before touching any code.

This action analyzes your PR changes and suggests updates to keep your Intent Layer in sync with your evolving codebase.

## Quick Start

### Basic Setup (PR Comments with Approval)

```yaml
# .github/workflows/intent-layer.yml
name: Intent Layer
on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: madisonbullard/github-action-intent-layer@v1
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Checkbox Handler (for PR Comments mode)

When using `output: pr_comments`, add this workflow to handle approval checkboxes:

```yaml
# .github/workflows/intent-layer-checkbox.yml
name: Intent Layer Checkbox
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
          fetch-depth: 0  # Required for file-level reverts
      - uses: madisonbullard/github-action-intent-layer@v1
        with:
          mode: checkbox-handler
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `mode` | Operation mode: `analyze` or `checkbox-handler` | `analyze` |
| `model` | LLM model (provider/model format) | `anthropic/claude-sonnet-4-20250514` |
| `files` | Files to manage: `agents`, `claude`, or `both` | `agents` |
| `output` | Output mode: `pr_comments`, `pr_commit`, or `new_pr` | `pr_comments` |
| `new_nodes` | Allow creating new intent nodes | `true` |
| `split_large_nodes` | Suggest splitting large nodes | `true` |
| `token_budget_percent` | Max token budget as % of covered code | `5` |
| `skip_binary_files` | Skip binary files in token counting | `true` |
| `file_max_lines` | Skip files exceeding this line count | `8000` |
| `symlink` | Create symlinks between AGENTS.md and CLAUDE.md | `false` |
| `symlink_source` | Source of truth when symlinking: `agents` or `claude` | `agents` |
| `prompts` | Pattern-matched custom prompts (YAML string) | `''` |

## Output Modes

### `pr_comments` (Default)

Posts one comment per affected intent node with:
- A diff showing the proposed change
- A checkbox to approve/reject the change

When a checkbox is checked, the action commits the change. When unchecked, it reverts.

### `pr_commit`

Automatically commits all proposed changes in a single commit. No approval required.

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    output: pr_commit
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### `new_pr`

Creates a separate PR with all intent layer updates, linking back to the original PR.

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    output: new_pr
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Authentication

### LLM API Key

The action requires an LLM API key to analyze changes. Provide one of:

- `ANTHROPIC_API_KEY` - For direct Anthropic API access
- `OPENROUTER_API_KEY` - For OpenRouter (supports multiple providers)

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Or with OpenRouter:

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    model: openrouter/anthropic/claude-sonnet-4-20250514
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

### GitHub Token

The action uses the repository's built-in `GITHUB_TOKEN` for GitHub API operations. Ensure your workflow has the required permissions:

```yaml
permissions:
  contents: write      # For committing changes
  pull-requests: write # For posting comments
  issues: write        # For PR comment interactions
```

## Advanced Configuration

### Custom Prompts

Provide pattern-matched prompts to customize how the LLM analyzes specific areas of your codebase:

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    prompts: |
      - pattern: "**/*"
        prompt: "Focus on architectural boundaries and contracts."
      - pattern: "packages/api/**"
        agents_prompt: "Document REST endpoints and request/response schemas."
        claude_prompt: "Focus on API error handling patterns."
      - pattern: "**/*.test.ts"
        prompt: "Test files should not have their own intent nodes."
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

When multiple patterns match, the most specific pattern wins (no merging).

### Ignoring Files

Create a `.intentlayerignore` file in your repository root to exclude files from analysis. Uses gitignore syntax:

```gitignore
# Ignore generated files
dist/
build/
*.generated.ts

# Ignore vendor code
vendor/
node_modules/

# Ignore specific patterns
**/*.min.js
```

Ignored files are excluded from both update triggers and token budget calculations.

### Token Budget

The action enforces a token budget to keep intent nodes concise:

```
Budget % = (intent_node_tokens / covered_code_tokens) * 100
```

Default threshold is 5%. Nodes exceeding this trigger split suggestions when `split_large_nodes: true`.

### Symlinks

When managing both `AGENTS.md` and `CLAUDE.md`, you can symlink them to avoid duplication:

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    files: both
    symlink: true
    symlink_source: agents  # AGENTS.md is source, CLAUDE.md is symlink
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Note:** Symlinks are Unix-only. The action will fail on Windows with `symlink: true`.

## How It Works

1. **Detection**: Scans for existing `AGENTS.md`/`CLAUDE.md` files and builds the hierarchy
2. **Analysis**: Maps changed files to their covering intent nodes
3. **Generation**: Uses the LLM to propose updates based on the PR context
4. **Output**: Posts comments, commits changes, or creates a PR based on your `output` setting

### Commit Message Conventions

The action uses these commit message prefixes:
- `[INTENT:ADD]` - New intent node created
- `[INTENT:UPDATE]` - Existing node updated
- `[INTENT:REVERT]` - Change reverted via checkbox

For `output: pr_commit`, all changes use a single commit:
```
[INTENT] apply intent layer updates
```

## Behavior Notes

- **No Intent Layer**: If no intent files exist, the action suggests creating a root `AGENTS.md` only
- **Large PRs**: PRs exceeding 100,000 lines changed are skipped with an informational message
- **Checkbox Debounce**: The checkbox handler waits 1.5s and verifies state before acting
- **Stale Suggestions**: Comments are marked `**RESOLVED**` when the PR head changes

## Permissions Required

```yaml
permissions:
  contents: write      # Commit intent layer changes
  pull-requests: write # Post and update PR comments
  issues: write        # Handle checkbox interactions
```

For `mode: checkbox-handler`, use `fetch-depth: 0` to enable file-level reverts:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

## Examples

### Minimal Configuration

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Full Configuration

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    mode: analyze
    model: anthropic/claude-sonnet-4-20250514
    files: both
    output: pr_comments
    new_nodes: true
    split_large_nodes: true
    token_budget_percent: 5
    skip_binary_files: true
    file_max_lines: 8000
    symlink: true
    symlink_source: agents
    prompts: |
      - pattern: "**/*"
        prompt: "Be concise. Focus on what code can't express."
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Claude Files Only

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    files: claude
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Strict Mode (No New Nodes)

```yaml
- uses: madisonbullard/github-action-intent-layer@v1
  with:
    new_nodes: false
    split_large_nodes: false
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Troubleshooting

### Action fails with API key error

Ensure your secret is correctly set in your repository settings and the environment variable name matches your provider (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`).

### Checkbox handler doesn't respond

- Verify the workflow file listens to `issue_comment` events
- Check that the comment contains `<!-- INTENT_LAYER` marker
- Ensure `fetch-depth: 0` is set for the checkout step

### Symlinks fail on Windows

Symlinks require Unix. Set `symlink: false` for Windows runners or use Unix-based runners.

### Comments marked as RESOLVED unexpectedly

This happens when the PR head SHA changes after the comment was posted. Push new commits to trigger a fresh analysis.

## License

MIT
