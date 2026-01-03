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

### Current CI Configuration

The existing `ci.yml` has:
- `lint` job (Biome check)
- `typecheck` job (TypeScript)
- `test` job (runs all tests via `bun test`)
- `build` job (depends on typecheck + test)
- Concurrency control (cancels in-progress runs on same ref)

**What needs to change:**
- Split `test` job into `test-unit` and `test-integration` (mocked)
- Add `workflow_dispatch` inputs for optional real API tests
- Add conditional jobs for real GitHub/LLM tests
- Add cleanup job for stale test branches

---

## Phase 1: Clean Up Redundant Tests

### Tasks
- [x] Delete `test/integration/no-intent-layer.test.ts`
- [x] Delete `test/integration/propose-new-node.test.ts`
- [x] Delete `test/integration/update-existing-node.test.ts`
- [x] Run full test suite to verify nothing breaks
- [x] Check if `test/fixtures/no-intent-layer/` is still used by remaining tests
  - **Result: KEEP** - Used by `test/unit/setup.test.ts` for:
    - Testing `listFixtures()` returns all fixtures
    - Testing `loadFixture("no-intent-layer")` works correctly
    - Testing `shouldSuggestRootAgentsMd()` returns true for repos without intent layer
- [x] Audit remaining tests for any dead code or unused fixtures
  - **Result:** All fixtures in use. Removed unused imports and prefixed unused function parameters with underscores using `bunx biome check --write`. Fixed 9 unused imports and 27 unused function parameters across 17 test files.

### Expected Outcome
- Remove ~1,370 lines of redundant test code
- Faster CI runs
- Clearer test organization

---

## Phase 2: Test Directory Reorganization

> **Note:** Execute this phase BEFORE Phases 3 and 4 to establish the directory structure.

### Proposed Structure
```
test/
├── fixtures/                    # Keep as-is
│   ├── basic-agents/
│   ├── nested-hierarchy/
│   ├── no-intent-layer/        # Keep if still used after Phase 1
│   ├── symlink-agents-source/
│   └── symlink-claude-source/
├── mocks/                       # NEW: Centralized mocks
│   ├── github.ts               # GitHub API mocks
│   └── opencode.ts             # OpenCode response mocks
├── unit/                        # Keep as-is (all passing)
│   ├── analyzer.test.ts
│   ├── checkbox-handler.test.ts
│   └── ...
├── integration/                 # Reorganized (only 5 files after Phase 1)
│   ├── checkbox-toggle-commit.test.ts
│   ├── checkbox-untoggle-revert.test.ts
│   ├── new-pr-output-mode.test.ts
│   ├── symlink-handling.test.ts
│   └── token-budget-enforcement.test.ts
├── integration-real-github/     # NEW: Real GitHub API tests
│   ├── setup.ts                # Branch creation/cleanup helpers
│   ├── pr-comment-flow.test.ts
│   └── checkbox-commit.test.ts
└── integration-llm/             # NEW: Real LLM tests
    ├── setup.ts
    └── analyze-changes.test.ts
```

### Tasks
- [x] Create `test/mocks/` directory
- [x] Create `test/mocks/github.ts` (stub file with TODO)
- [x] Create `test/mocks/opencode.ts` (stub file with TODO)
- [x] Create `test/integration-real-github/` directory
- [x] Create `test/integration-real-github/setup.ts` (stub file with TODO)
- [ ] Create `test/integration-llm/` directory
- [ ] Create `test/integration-llm/setup.ts` (stub file with TODO)

---

## Phase 3: OpenCode Mocking Strategy

### Default Behavior (Fast Tests)
Mock OpenCode responses that conform to the output schema. TypeScript typing is sufficient for validation.

### Tasks
- [ ] Implement `test/mocks/opencode.ts` with `mockOpenCodeResponse` function
- [ ] Implement mock scenarios: `update`, `create`, `delete`, `no-changes`
- [ ] Update existing integration tests to use centralized mocks (if not already)
- [ ] Implement `test/mocks/github.ts` with common GitHub API mocks

### Example Implementation
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

---

## Phase 4: Real GitHub Integration Tests

### Strategy
Use branches in THIS repo for real GitHub API testing.

### Branch Naming
```
test-fixture/<run-id>-<timestamp>
```
Example: `test-fixture/12345678-1704067200`

This ensures uniqueness even if concurrent CI runs occur.

### Test Scenarios
- [ ] **PR Comment Flow**: Create PR → run action → verify comment posted with correct format
- [ ] **Checkbox Commit Flow**: Toggle checkbox → verify intent commit created
- [ ] **Checkbox Revert Flow**: Untoggle checkbox → verify file reverted
- [ ] **Rate Limit Handling**: Verify exponential backoff works

### Implementation Tasks
- [ ] Implement `test/integration-real-github/setup.ts`:
  ```typescript
  export async function createTestBranch(runId: string): Promise<string> {
    const timestamp = Date.now();
    const branchName = `test-fixture/${runId}-${timestamp}`;
    // Use GITHUB_TOKEN from CI environment
    // Create branch from HEAD of main
    return branchName;
  }

  export async function cleanupTestBranch(branchName: string): Promise<void> {
    // Delete branch via GitHub API
  }
  ```
- [ ] Implement PR comment flow test
- [ ] Implement checkbox commit flow test
- [ ] Wrap test execution in try/finally to ensure cleanup on failure

### Permissions Note
We'll use `GITHUB_TOKEN` initially. If permissions are insufficient for branch/PR creation, we'll need to switch to a PAT with elevated permissions.

---

## Phase 5: CI Configuration Updates

### Changes to `ci.yml`

**Keep (unchanged):**
- `lint` job
- `typecheck` job
- `build` job structure
- Concurrency control

**Modify:**
- Split `test` job into `test-unit` and `test-integration`
- Update `build` job dependencies to `[lint, typecheck, test-unit, test-integration]`

**Add:**
- `workflow_dispatch` trigger with inputs for optional real API tests
- `test-github-real` job (conditional on `workflow_dispatch` input)
- `test-llm-real` job (conditional on `workflow_dispatch` input)
- `cleanup-test-branches` job (scheduled daily OR on test failure)

### Tasks
- [ ] Add `workflow_dispatch` trigger with boolean inputs:
  - `run_llm_tests` (default: false)
  - `run_github_tests` (default: false)
- [ ] Rename `test` job to `test-unit`, change command to `bun test test/unit/`
- [ ] Add `test-integration` job running `bun test test/integration/`
- [ ] Add conditional `test-github-real` job:
  ```yaml
  test-github-real:
    name: Real GitHub API Tests
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.run_github_tests == 'true'
    runs-on: ubuntu-latest
    steps:
      # ... setup steps ...
      - name: Run real GitHub tests
        run: bun test test/integration-real-github/
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- [ ] Add conditional `test-llm-real` job:
  ```yaml
  test-llm-real:
    name: Real LLM Tests
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.run_llm_tests == 'true'
    runs-on: ubuntu-latest
    steps:
      # ... setup steps ...
      - name: Run real LLM tests
        run: bun test test/integration-llm/
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  ```
- [ ] Add cleanup job for test branches:
  ```yaml
  cleanup-test-branches:
    name: Cleanup Test Branches
    runs-on: ubuntu-latest
    needs: [test-github-real]
    # Always run after real GitHub tests (success or failure)
    if: always() && needs.test-github-real.result != 'skipped'
    steps:
      - uses: actions/checkout@v4
      - name: Delete test-fixture branches
        run: |
          gh api repos/${{ github.repository }}/branches --paginate -q '.[].name' | \
            grep '^test-fixture/' | \
            while read branch; do
              echo "Deleting branch: $branch"
              gh api repos/${{ github.repository }}/git/refs/heads/$branch --method DELETE || true
            done
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- [ ] Update `build` job `needs` to: `[lint, typecheck, test-unit, test-integration]`

---

## Execution Timeline

| Phase | Description | Estimated Time | Dependencies |
|-------|-------------|----------------|--------------|
| 1 | Clean up redundant tests | 30 min | None |
| 2 | Test directory reorganization | 30 min | Phase 1 |
| 3 | OpenCode mocking strategy | 1-2 hours | Phase 2 |
| 4 | Real GitHub integration tests | 2-3 hours | Phase 2 |
| 5 | CI configuration updates | 30 min | Phases 3, 4 |

**Total: ~5-6 hours**

---

## Success Criteria

- [ ] **Fast CI**: Unit + mocked integration tests complete in < 3 minutes
- [ ] **No redundancy**: Each test covers a unique scenario
- [ ] **Real API coverage**: Optional tests verify actual GitHub API behavior
- [ ] **Clear organization**: Test structure mirrors source structure
- [ ] **Documentation**: Each test file has clear docstring explaining what it tests
- [ ] **Maintainability**: New tests are easier to write and understand
- [ ] **Coverage**: No regression in test coverage from Phase 1 cleanup

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

- [ ] **Monitor CI performance** - Ensure mocked tests run in < 3 minutes
- [ ] **Document real test procedures** - Add README explaining how to run real GitHub/LLM tests
- [ ] **Consider additional coverage** - After Phase 1, evaluate if additional real API tests needed
- [ ] **Future: Parallelization** - Consider splitting unit tests for faster CI
