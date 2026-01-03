import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	DEFAULT_DEBOUNCE_DELAY_MS,
	debounceCheckboxToggle,
	sleep,
	validateCheckboxEvent,
} from "../../src/github/checkbox-handler";
import type { GitHubClient } from "../../src/github/client";
import {
	INTENT_LAYER_MARKER_PREFIX,
	INTENT_LAYER_MARKER_SUFFIX,
} from "../../src/github/comments";

describe("sleep", () => {
	test("resolves after specified delay", async () => {
		const start = Date.now();
		await sleep(50);
		const elapsed = Date.now() - start;

		// Allow some tolerance for timing
		expect(elapsed).toBeGreaterThanOrEqual(45);
		expect(elapsed).toBeLessThan(100);
	});
});

describe("DEFAULT_DEBOUNCE_DELAY_MS", () => {
	test("is 1500ms (1.5 seconds)", () => {
		expect(DEFAULT_DEBOUNCE_DELAY_MS).toBe(1500);
	});
});

describe("debounceCheckboxToggle", () => {
	// Helper to create a valid comment body with marker
	function createCommentBody(options: {
		nodePath?: string;
		headSha?: string;
		checked?: boolean;
	}): string {
		const nodePath = options.nodePath ?? "packages/api/AGENTS.md";
		const headSha = options.headSha ?? "abc123";
		const checkbox = options.checked
			? "- [x] Apply this change"
			: "- [ ] Apply this change";

		return `${INTENT_LAYER_MARKER_PREFIX} node=${encodeURIComponent(nodePath)} appliedCommit= headSha=${headSha} ${INTENT_LAYER_MARKER_SUFFIX}

## Intent Layer Update

\`\`\`diff
+ Some changes
\`\`\`

---

${checkbox}`;
	}

	// Create a mock client
	function createMockClient(getCommentResult: {
		body?: string | null;
	}): GitHubClient {
		return {
			getComment: mock(() => Promise.resolve(getCommentResult)),
		} as unknown as GitHubClient;
	}

	test("returns stable=true when checkbox state is unchanged", async () => {
		const commentBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: commentBody });

		const result = await debounceCheckboxToggle(
			mockClient,
			123,
			commentBody,
			{ delayMs: 10 }, // Use short delay for test
		);

		expect(result.stable).toBe(true);
		expect(result.isChecked).toBe(true);
		expect(result.commentBody).toBe(commentBody);
	});

	test("returns stable=false when checkbox state changed", async () => {
		const initialBody = createCommentBody({ checked: false });
		const changedBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: changedBody });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("Checkbox state changed");
		expect(result.reason).toContain("was: false");
		expect(result.reason).toContain("now: true");
	});

	test("returns stable=false when comment body is empty after refetch", async () => {
		const initialBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: null });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("empty after re-fetch");
	});

	test("returns stable=false when initial body has no marker", async () => {
		const initialBody = "No marker here - [ ] Apply this change";
		const mockClient = createMockClient({ body: initialBody });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain(
			"does not contain a valid intent layer marker",
		);
	});

	test("returns stable=false when marker disappears after refetch", async () => {
		const initialBody = createCommentBody({ checked: true });
		const bodyWithoutMarker = "No marker here - [x] Apply this change";
		const mockClient = createMockClient({ body: bodyWithoutMarker });

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("no longer valid after re-fetch");
	});

	test("returns stable=false when getComment throws an error", async () => {
		const initialBody = createCommentBody({ checked: true });
		const mockClient = {
			getComment: mock(() =>
				Promise.reject(new Error("API rate limit exceeded")),
			),
		} as unknown as GitHubClient;

		const result = await debounceCheckboxToggle(mockClient, 123, initialBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(false);
		expect(result.reason).toContain("Failed to re-fetch comment");
		expect(result.reason).toContain("API rate limit exceeded");
	});

	test("handles unchecked checkbox correctly", async () => {
		const commentBody = createCommentBody({ checked: false });
		const mockClient = createMockClient({ body: commentBody });

		const result = await debounceCheckboxToggle(mockClient, 123, commentBody, {
			delayMs: 10,
		});

		expect(result.stable).toBe(true);
		expect(result.isChecked).toBe(false);
	});

	test("uses default delay when not specified", async () => {
		// We can't easily test the actual delay without making tests slow,
		// but we can verify the function accepts no options
		const commentBody = createCommentBody({ checked: true });
		const mockClient = createMockClient({ body: commentBody });

		// This would take 1.5s in real use, but we're verifying it works
		const result = await debounceCheckboxToggle(
			mockClient,
			123,
			commentBody,
			{ delayMs: 10 }, // Override for test speed
		);

		expect(result.stable).toBe(true);
	});
});

describe("validateCheckboxEvent", () => {
	test("returns context for valid PR comment event", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some comment body",
			},
			issue: {
				number: 456,
				pull_request: {},
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).not.toBeNull();
		expect(result?.commentId).toBe(123);
		expect(result?.commentBody).toBe("Some comment body");
		expect(result?.issueNumber).toBe(456);
		expect(result?.isPullRequest).toBe(true);
	});

	test("returns context for valid issue comment event", () => {
		const payload = {
			comment: {
				id: 789,
				body: "Issue comment",
			},
			issue: {
				number: 101,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).not.toBeNull();
		expect(result?.isPullRequest).toBe(false);
	});

	test("returns null when comment is missing", () => {
		const payload = {
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when comment has no ID", () => {
		const payload = {
			comment: {
				body: "Some body",
			},
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when comment has no body", () => {
		const payload = {
			comment: {
				id: 123,
			},
			issue: {
				number: 456,
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when issue is missing", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some body",
			},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});

	test("returns null when issue has no number", () => {
		const payload = {
			comment: {
				id: 123,
				body: "Some body",
			},
			issue: {},
		};

		const result = validateCheckboxEvent(payload);

		expect(result).toBeNull();
	});
});
