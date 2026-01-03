# Test Suite Improvement Plan

## Current State Analysis

### Integration Tests (8 files, ~4,765 lines)

| File | Lines | Verdict | Rationale |
|------|-------|---------|-----------|
| `checkbox-toggle-commit.test.ts` | ~780 | **KEEP** | Tests critical user workflow: checkbox checked → intent commit created |
| `checkbox-untoggle-revert.test.ts` | ~720 | **KEEP** | Tests revert flow when unchecking checkbox |
| `new-pr-output-mode.test.ts` | ~685 | **KEEP** | Tests `output: new_pr` mode (separate PR for changes) |
| `symlink-handling.test.ts` | ~610 | **KEEP** | Tests AGENTS.md ↔ CLAUDE.md symlink relationships |
| `token-budget-enforcement.test.ts` | ~600 | **KEEP** | Tests binary/large file skipping in token calculations |
| `no-intent-layer.test.ts` | ~350 | **DELETE** | Redundant - `analyzer.test.ts` covers initialization scenarios |
| `propose-new-node.test.ts` | ~600 | **DELETE** | Redundant - `analyzer.test.ts` covers new node proposals |
| `update-existing-node.test.ts` | ~420 | **DELETE** | Redundant - `analyzer.test.ts` and `hierarchy.test.ts` cover updates |

### Unit Tests (comprehensive coverage exists)

- `analyzer.test.ts` (1,711 lines) - Already covers scenarios in redundant integration tests
- `hierarchy.test.ts` (918 lines) - Comprehensive hierarchy coverage
- `detector.test.ts` (1,053 lines) - Comprehensive symlink detection coverage
- `tokenizer.test.ts` (1,272 lines) - Comprehensive token budget coverage

---

## Phase 1: Clean Up Redundant Tests

### Tasks
1. Delete `test/integration/no-intent-layer.test.ts`
2. Delete `test/integration/propose-new-node.test.ts`
3. Delete `test/integration/update-existing-node.test.ts`
4. Run full test suite to verify nothing breaks
5. Audit remaining tests for any dead code or unused fixtures

### Expected Outcome
- Remove ~1,370 lines of redundant test code
- Faster CI runs
- Clearer test organization

---

## Phase 2: Real GitHub Integration Tests

### Strategy
Use branches in THIS repo (not a separate test repo) for real GitHub API testing.

### Design
```
Branch naming: test-fixture/<run-id>
Lifecycle:
  1. Create branch from known base commit
  2. Create PR against branch
  3. Execute real GitHub API operations
  4. Verify comments, commits, PR state
  5. Delete branch (cleanup)
```

### Test Scenarios
1. **PR Comment Flow**: Create PR → run action → verify comment posted with correct format
2. **Checkbox Commit Flow**: Toggle checkbox → verify intent commit created
3. **Checkbox Revert Flow**: Untoggle checkbox → verify file reverted
4. **Rate Limit Handling**: Verify exponential backoff works

### Implementation
```typescript
// test/integration/real-github/setup.ts
export async function createTestBranch(runId: string): Promise<string> {
  const branchName = `test-fixture/${runId}`;
  // Use GITHUB_TOKEN from CI environment
  // Create branch from HEAD of main
  return branchName;
}

export async function cleanupTestBranch(branchName: string): Promise<void> {
  // Delete branch via GitHub API
}
```

### CI Configuration
- Tests run on PRs (with mocked GitHub by default)
- Real GitHub tests only run via `workflow_dispatch` with checkbox

---

## Phase 3: OpenCode Mocking Strategy

### Default Behavior (Fast Tests)
Mock OpenCode responses that conform to the output schema:

```typescript
// test/mocks/opencode.ts
import type { IntentLayerOutput } from '../../src/opencode/output-schema';

export function mockOpenCodeResponse(scenario: 'update' | 'create' | 'delete' | 'no-changes'): IntentLayerOutput {
  switch (scenario) {
    case 'update':
      return {
        updates: [{
          nodePath: 'AGENTS.md',
          action: 'update',
          reason: 'Mock update reason',
          currentContent: '# Existing content',
          suggestedContent: '# Updated content',
        }]
      };
    // ... other scenarios
  }
}
```

### Real LLM Tests (Optional)
Enable via environment variable or workflow_dispatch:

```yaml
# In CI workflow
- name: Run LLM integration tests
  if: github.event.inputs.run_llm_tests == 'true'
  run: bun test test/integration/llm/
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    RUN_REAL_LLM_TESTS: 'true'
```

---

## Phase 4: CI Configuration Updates

### Updated `ci.yml`
```yaml
name: CI

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      run_llm_tests:
        description: 'Run real LLM integration tests'
        required: false
        default: false
        type: boolean
      run_github_tests:
        description: 'Run real GitHub API integration tests'
        required: false
        default: false
        type: boolean

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run Biome check
        run: bun biome check --diagnostic-level=error

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run TypeScript typecheck
        run: bun run typecheck

  test-unit:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run unit tests
        run: bun test test/unit/

  test-integration:
    name: Integration Tests (Mocked)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run integration tests
        run: bun test test/integration/

  test-github-real:
    name: Real GitHub API Tests
    if: github.event.inputs.run_github_tests == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run real GitHub tests
        run: bun test test/integration-real-github/
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  test-llm-real:
    name: Real LLM Tests
    if: github.event.inputs.run_llm_tests == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run real LLM tests
        run: bun test test/integration-llm/
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test-unit, test-integration]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Build action
        run: bun run build
      - name: Verify dist output
        run: |
          if [ ! -f dist/index.js ]; then
            echo "Build failed: dist/index.js not found"
            exit 1
          fi
          echo "Build successful: dist/index.js exists"
```

---

## Phase 5: Test Directory Reorganization

### Proposed Structure
```
test/
├── fixtures/                    # Keep as-is
│   ├── basic-agents/
│   ├── nested-hierarchy/
│   ├── no-intent-layer/
│   ├── symlink-agents-source/
│   └── symlink-claude-source/
├── mocks/                       # NEW: Centralized mocks
│   ├── github.ts               # GitHub API mocks
│   └── opencode.ts             # OpenCode response mocks
├── unit/                        # Keep as-is (all passing)
│   ├── analyzer.test.ts
│   ├── checkbox-handler.test.ts
│   └── ...
├── integration/                 # Reorganized (only keep 5 files)
│   ├── checkbox-toggle-commit.test.ts     # KEEP
│   ├── checkbox-untoggle-revert.test.ts   # KEEP
│   ├── new-pr-output-mode.test.ts         # KEEP
│   ├── symlink-handling.test.ts           # KEEP
│   └── token-budget-enforcement.test.ts   # KEEP
├── integration-real-github/     # NEW: Real GitHub API tests
│   ├── pr-comment-flow.test.ts
│   ├── checkbox-commit.test.ts
│   └── setup.ts
└── integration-llm/             # NEW: Real LLM tests
    ├── analyze-changes.test.ts
    └── setup.ts
```

---

## Execution Timeline

| Phase | Description | Estimated Time |
|-------|-------------|----------------|
| 1 | Clean up redundant tests | 30 min |
| 2 | Real GitHub integration tests | 2-3 hours |
| 3 | OpenCode mocking strategy | 1-2 hours |
| 4 | CI configuration updates | 30 min |
| 5 | Test directory reorganization | 30 min |

**Total: ~5-6 hours**

---

## Success Criteria

1. **Fast CI**: Unit + mocked integration tests complete in < 3 minutes
2. **No redundancy**: Each test covers a unique scenario
3. **Real API coverage**: Optional tests verify actual GitHub API behavior
4. **Clear organization**: Test structure mirrors source structure
5. **Documentation**: Each test file has clear docstring explaining what it tests
6. **Maintainability**: New tests are easier to write and understand
7. **Coverage**: No regression in test coverage from Phase 1 cleanup

---

## Implementation Notes

### Why Delete Those 3 Tests?

**`no-intent-layer.test.ts`**
- Tests: Creating initial AGENTS.md when no intent layer exists
- Already covered by: `analyzer.test.ts` with unit tests for initialization flow
- Benefit of deletion: Remove ~350 lines of integration test overhead

**`propose-new-node.test.ts`**
- Tests: LLM suggestion to create new intent nodes
- Already covered by: `analyzer.test.ts` with comprehensive new node detection scenarios
- Benefit of deletion: Remove ~600 lines; unit tests are more focused and faster

**`update-existing-node.test.ts`**
- Tests: LLM suggestion to update existing nodes
- Already covered by: `analyzer.test.ts` for analysis + `hierarchy.test.ts` for node structure
- Benefit of deletion: Remove ~420 lines; unit tests are more focused and faster

### Why Keep Those 5 Tests?

These tests exercise **end-to-end workflows** that cannot be adequately tested at the unit level:

1. **`checkbox-toggle-commit.test.ts`** - User approval flow → commit creation (involves GitHub API + local git)
2. **`checkbox-untoggle-revert.test.ts`** - User disapproval flow → file revert (involves git history)
3. **`new-pr-output-mode.test.ts`** - Separate PR creation (involves GitHub API + branch management)
4. **`symlink-handling.test.ts`** - Bidirectional symlink management (filesystem + git operations)
5. **`token-budget-enforcement.test.ts`** - Binary file skipping logic (filesystem + token calculations)

---

## Next Steps After Implementation

1. **Monitor CI performance** - Ensure mocked tests run in < 3 minutes
2. **Document real test procedures** - Add README explaining how to run real GitHub/LLM tests
3. **Consider additional coverage** - After Phase 1, evaluate if additional real API tests needed
4. **Future: Parallelization** - Consider splitting unit tests for faster CI
