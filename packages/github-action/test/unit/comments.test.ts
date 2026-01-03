import { describe, expect, mock, test } from "bun:test";
import type { GitHubClient } from "../../src/github/client";
import {
	type CommentMarkerData,
	clearCommentMarkerAppliedCommit,
	detectCheckboxState,
	findCommentForNode,
	findIntentLayerComments,
	generateComment,
	generateCommentMarker,
	hasCheckbox,
	hasIntentLayerMarker,
	INTENT_LAYER_MARKER_PREFIX,
	INTENT_LAYER_MARKER_SUFFIX,
	isCheckboxChecked,
	isCommentResolved,
	markCommentAsResolved,
	type PostedComment,
	parseCommentMarker,
	postCommentsForUpdates,
	type ResolvedCommentResult,
	resolveAndPostComments,
	shouldSkipCheckboxProcessing,
	updateCheckboxState,
	updateCommentMarkerWithCommit,
} from "../../src/github/comments";
import type { IntentUpdate } from "../../src/opencode/output-schema";

describe("generateCommentMarker", () => {
	test("generates marker with required fields", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "abc123",
		};

		const marker = generateCommentMarker(data);

		expect(marker).toContain(INTENT_LAYER_MARKER_PREFIX);
		expect(marker).toContain(INTENT_LAYER_MARKER_SUFFIX);
		expect(marker).toContain("node=packages%2Fapi%2FAGENTS.md");
		expect(marker).toContain("headSha=abc123");
		expect(marker).toContain("appliedCommit=");
	});

	test("generates marker with otherNodePath", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			headSha: "abc123",
		};

		const marker = generateCommentMarker(data);

		expect(marker).toContain("otherNode=packages%2Fapi%2FCLAUDE.md");
	});

	test("generates marker with appliedCommit", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/api/AGENTS.md",
			headSha: "abc123",
			appliedCommit: "def456",
		};

		const marker = generateCommentMarker(data);

		expect(marker).toContain("appliedCommit=def456");
	});

	test("properly escapes paths with special characters", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/my package/AGENTS.md",
			headSha: "abc123",
		};

		const marker = generateCommentMarker(data);

		// Space should be encoded as %20
		expect(marker).toContain("packages%2Fmy%20package%2FAGENTS.md");
	});
});

describe("parseCommentMarker", () => {
	test("parses marker with required fields", () => {
		const marker = `${INTENT_LAYER_MARKER_PREFIX} node=packages%2Fapi%2FAGENTS.md appliedCommit= headSha=abc123 ${INTENT_LAYER_MARKER_SUFFIX}`;

		const result = parseCommentMarker(marker);

		expect(result).not.toBeNull();
		expect(result?.nodePath).toBe("packages/api/AGENTS.md");
		expect(result?.headSha).toBe("abc123");
		expect(result?.appliedCommit).toBeUndefined();
	});

	test("parses marker with all fields", () => {
		const marker = `${INTENT_LAYER_MARKER_PREFIX} node=packages%2Fapi%2FAGENTS.md otherNode=packages%2Fapi%2FCLAUDE.md appliedCommit=def456 headSha=abc123 ${INTENT_LAYER_MARKER_SUFFIX}`;

		const result = parseCommentMarker(marker);

		expect(result).not.toBeNull();
		expect(result?.nodePath).toBe("packages/api/AGENTS.md");
		expect(result?.otherNodePath).toBe("packages/api/CLAUDE.md");
		expect(result?.appliedCommit).toBe("def456");
		expect(result?.headSha).toBe("abc123");
	});

	test("parses marker embedded in comment body", () => {
		const body = `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md appliedCommit= headSha=abc123 ${INTENT_LAYER_MARKER_SUFFIX}

### Update: \`AGENTS.md\`

Some content here...

- [ ] Apply this change`;

		const result = parseCommentMarker(body);

		expect(result).not.toBeNull();
		expect(result?.nodePath).toBe("AGENTS.md");
	});

	test("returns null for invalid marker", () => {
		const body = "This is a regular comment with no marker";
		const result = parseCommentMarker(body);
		expect(result).toBeNull();
	});

	test("returns null for incomplete marker", () => {
		// Missing headSha
		const marker = `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md appliedCommit= ${INTENT_LAYER_MARKER_SUFFIX}`;
		const result = parseCommentMarker(marker);
		expect(result).toBeNull();
	});

	test("handles paths with special characters", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/my package/AGENTS.md",
			headSha: "abc123",
		};
		const marker = generateCommentMarker(data);
		const result = parseCommentMarker(marker);

		expect(result?.nodePath).toBe("packages/my package/AGENTS.md");
	});
});

describe("hasIntentLayerMarker", () => {
	test("returns true for body with marker", () => {
		const body = `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}`;
		expect(hasIntentLayerMarker(body)).toBe(true);
	});

	test("returns false for body without marker", () => {
		const body = "Just a regular comment";
		expect(hasIntentLayerMarker(body)).toBe(false);
	});
});

describe("generateComment", () => {
	test("generates comment with marker, diff, and checkbox", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			action: "update",
			reason: "API changes require documentation update",
			currentContent: "# API\n\nOld content.\n",
			suggestedContent: "# API\n\nNew content.\n",
		};

		const comment = generateComment(update, "abc123");

		// Check marker
		expect(comment).toContain(INTENT_LAYER_MARKER_PREFIX);
		expect(comment).toContain("node=packages%2Fapi%2FAGENTS.md");
		expect(comment).toContain("headSha=abc123");

		// Check diff content
		expect(comment).toContain("### Update: `packages/api/AGENTS.md`");
		expect(comment).toContain(
			"**Reason:** API changes require documentation update",
		);

		// Check checkbox
		expect(comment).toContain("- [ ] Apply this change");
	});

	test("generates comment without checkbox when disabled", () => {
		const update: IntentUpdate = {
			nodePath: "AGENTS.md",
			action: "create",
			reason: "Initialize intent layer",
			suggestedContent: "# Root\n",
		};

		const comment = generateComment(update, "abc123", {
			includeCheckbox: false,
		});

		expect(comment).not.toContain("- [ ] Apply this change");
	});

	test("includes otherNodePath in marker when present", () => {
		const update: IntentUpdate = {
			nodePath: "packages/api/AGENTS.md",
			otherNodePath: "packages/api/CLAUDE.md",
			action: "create",
			reason: "New package",
			suggestedContent: "# API\n",
		};

		const comment = generateComment(update, "abc123");

		expect(comment).toContain("otherNode=packages%2Fapi%2FCLAUDE.md");
	});
});

describe("updateCommentMarkerWithCommit", () => {
	test("updates marker with applied commit", () => {
		const originalComment = generateComment(
			{
				nodePath: "AGENTS.md",
				action: "update",
				reason: "Test",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			"headsha123",
		);

		const updated = updateCommentMarkerWithCommit(
			originalComment,
			"commitsha456",
		);

		expect(updated).toContain("appliedCommit=commitsha456");

		// Verify parsing works
		const parsed = parseCommentMarker(updated);
		expect(parsed?.appliedCommit).toBe("commitsha456");
	});

	test("returns original if no marker found", () => {
		const body = "No marker here";
		const result = updateCommentMarkerWithCommit(body, "sha123");
		expect(result).toBe(body);
	});
});

describe("clearCommentMarkerAppliedCommit", () => {
	test("clears applied commit from marker", () => {
		const data: CommentMarkerData = {
			nodePath: "AGENTS.md",
			headSha: "head123",
			appliedCommit: "commit456",
		};
		const marker = generateCommentMarker(data);
		const body = `${marker}\n\nSome content`;

		const cleared = clearCommentMarkerAppliedCommit(body);
		const parsed = parseCommentMarker(cleared);

		expect(parsed?.appliedCommit).toBeUndefined();
	});

	test("returns original if no marker found", () => {
		const body = "No marker here";
		const result = clearCommentMarkerAppliedCommit(body);
		expect(result).toBe(body);
	});
});

describe("detectCheckboxState", () => {
	test("detects checked checkbox", () => {
		const body = "Some content\n\n- [x] Apply this change";
		const result = detectCheckboxState(body);
		expect(result.hasCheckbox).toBe(true);
		expect(result.isChecked).toBe(true);
	});

	test("detects unchecked checkbox", () => {
		const body = "Some content\n\n- [ ] Apply this change";
		const result = detectCheckboxState(body);
		expect(result.hasCheckbox).toBe(true);
		expect(result.isChecked).toBe(false);
	});

	test("detects no checkbox", () => {
		const body = "Some content without checkbox";
		const result = detectCheckboxState(body);
		expect(result.hasCheckbox).toBe(false);
		expect(result.isChecked).toBe(false);
	});

	test("handles empty body", () => {
		const result = detectCheckboxState("");
		expect(result.hasCheckbox).toBe(false);
		expect(result.isChecked).toBe(false);
	});

	test("handles body with only marker and no checkbox", () => {
		const body = `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}\n\nSome diff content`;
		const result = detectCheckboxState(body);
		expect(result.hasCheckbox).toBe(false);
		expect(result.isChecked).toBe(false);
	});

	test("does not match similar but incorrect checkbox formats", () => {
		// Different checkbox text
		const body1 = "- [x] Some other checkbox";
		expect(detectCheckboxState(body1).hasCheckbox).toBe(false);

		// Different format
		const body2 = "[x] Apply this change";
		expect(detectCheckboxState(body2).hasCheckbox).toBe(false);
	});
});

describe("hasCheckbox", () => {
	test("returns true for checked checkbox", () => {
		const body = "Content\n\n- [x] Apply this change";
		expect(hasCheckbox(body)).toBe(true);
	});

	test("returns true for unchecked checkbox", () => {
		const body = "Content\n\n- [ ] Apply this change";
		expect(hasCheckbox(body)).toBe(true);
	});

	test("returns false for no checkbox", () => {
		const body = "Content without checkbox";
		expect(hasCheckbox(body)).toBe(false);
	});
});

describe("isCheckboxChecked", () => {
	test("returns true for checked checkbox", () => {
		const body = "Some content\n\n- [x] Apply this change";
		expect(isCheckboxChecked(body)).toBe(true);
	});

	test("returns false for unchecked checkbox", () => {
		const body = "Some content\n\n- [ ] Apply this change";
		expect(isCheckboxChecked(body)).toBe(false);
	});

	test("returns false for no checkbox", () => {
		const body = "Some content without checkbox";
		expect(isCheckboxChecked(body)).toBe(false);
	});
});

describe("shouldSkipCheckboxProcessing", () => {
	test("returns true when unchecked and no appliedCommit", () => {
		expect(shouldSkipCheckboxProcessing(false, undefined)).toBe(true);
	});

	test("returns true when unchecked and appliedCommit is empty string", () => {
		// Empty string is falsy, should be treated as no commit
		expect(shouldSkipCheckboxProcessing(false, "")).toBe(true);
	});

	test("returns false when unchecked but has appliedCommit (needs revert)", () => {
		expect(shouldSkipCheckboxProcessing(false, "abc123")).toBe(false);
	});

	test("returns false when checked and no appliedCommit (needs apply)", () => {
		expect(shouldSkipCheckboxProcessing(true, undefined)).toBe(false);
	});

	test("returns false when checked and has appliedCommit (already applied, but may need re-check)", () => {
		expect(shouldSkipCheckboxProcessing(true, "abc123")).toBe(false);
	});
});

describe("updateCheckboxState", () => {
	test("checks an unchecked checkbox", () => {
		const body = "Content\n\n- [ ] Apply this change";
		const result = updateCheckboxState(body, true);
		expect(result).toContain("- [x] Apply this change");
	});

	test("unchecks a checked checkbox", () => {
		const body = "Content\n\n- [x] Apply this change";
		const result = updateCheckboxState(body, false);
		expect(result).toContain("- [ ] Apply this change");
	});

	test("handles already checked checkbox", () => {
		const body = "Content\n\n- [x] Apply this change";
		const result = updateCheckboxState(body, true);
		expect(result).toContain("- [x] Apply this change");
	});

	test("handles already unchecked checkbox", () => {
		const body = "Content\n\n- [ ] Apply this change";
		const result = updateCheckboxState(body, false);
		expect(result).toContain("- [ ] Apply this change");
	});
});

describe("markCommentAsResolved", () => {
	test("adds resolved marker to comment", () => {
		const comment = generateComment(
			{
				nodePath: "AGENTS.md",
				action: "update",
				reason: "Test",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			"abc123",
		);

		const resolved = markCommentAsResolved(comment);

		expect(resolved).toContain("**RESOLVED**");
		expect(resolved).toContain("This suggestion is no longer applicable");
	});

	test("does not double-mark resolved comments", () => {
		const comment = generateComment(
			{
				nodePath: "AGENTS.md",
				action: "update",
				reason: "Test",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			"abc123",
		);

		const resolved = markCommentAsResolved(comment);
		const doubleResolved = markCommentAsResolved(resolved);

		// Count occurrences of **RESOLVED**
		const matches = doubleResolved.match(/\*\*RESOLVED\*\*/g);
		expect(matches?.length).toBe(1);
	});
});

describe("isCommentResolved", () => {
	test("returns true for resolved comment", () => {
		const body = "**RESOLVED** - Some message\n\nContent";
		expect(isCommentResolved(body)).toBe(true);
	});

	test("returns false for non-resolved comment", () => {
		const body = "Some content without resolved marker";
		expect(isCommentResolved(body)).toBe(false);
	});
});

describe("findIntentLayerComments", () => {
	test("finds comments with intent layer markers", () => {
		const comments = [
			{ id: 1, body: "Regular comment" },
			{
				id: 2,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
			{ id: 3, body: "Another regular comment" },
			{
				id: 4,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=other.md headSha=def ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
		];

		const found = findIntentLayerComments(comments);

		expect(found.length).toBe(2);
		expect(found[0]?.id).toBe(2);
		expect(found[1]?.id).toBe(4);
	});

	test("returns empty array when no markers found", () => {
		const comments = [
			{ id: 1, body: "Regular comment" },
			{ id: 2, body: "Another regular comment" },
		];

		const found = findIntentLayerComments(comments);

		expect(found.length).toBe(0);
	});

	test("handles comments with null/undefined body", () => {
		const comments = [
			{ id: 1, body: null },
			{ id: 2, body: undefined },
			{
				id: 3,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
		];

		const found = findIntentLayerComments(comments);

		expect(found.length).toBe(1);
		expect(found[0]?.id).toBe(3);
	});
});

describe("findCommentForNode", () => {
	test("finds comment for specific node path", () => {
		const comments = [
			{
				id: 1,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=packages%2Fapi%2FAGENTS.md appliedCommit= headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
			{
				id: 2,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=packages%2Fcore%2FAGENTS.md appliedCommit= headSha=def ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
		];

		const found = findCommentForNode(comments, "packages/api/AGENTS.md");

		expect(found).not.toBeUndefined();
		expect(found?.id).toBe(1);
	});

	test("returns undefined when node not found", () => {
		const comments = [
			{
				id: 1,
				body: `${INTENT_LAYER_MARKER_PREFIX} node=AGENTS.md appliedCommit= headSha=abc ${INTENT_LAYER_MARKER_SUFFIX}`,
			},
		];

		const found = findCommentForNode(comments, "other/AGENTS.md");

		expect(found).toBeUndefined();
	});
});

describe("round-trip marker encoding", () => {
	test("encodes and decodes marker data correctly", () => {
		const data: CommentMarkerData = {
			nodePath: "packages/my-package/src/AGENTS.md",
			otherNodePath: "packages/my-package/src/CLAUDE.md",
			headSha: "abcdef1234567890",
			appliedCommit: "1234567890abcdef",
		};

		const marker = generateCommentMarker(data);
		const parsed = parseCommentMarker(marker);

		expect(parsed).not.toBeNull();
		expect(parsed?.nodePath).toBe(data.nodePath);
		expect(parsed?.otherNodePath).toBe(data.otherNodePath);
		expect(parsed?.headSha).toBe(data.headSha);
		expect(parsed?.appliedCommit).toBe(data.appliedCommit);
	});

	test("handles paths with various special characters", () => {
		const specialPaths = [
			"path/with spaces/AGENTS.md",
			"path/with%percent/AGENTS.md",
			"path/with=equals/AGENTS.md",
		];

		for (const path of specialPaths) {
			const data: CommentMarkerData = {
				nodePath: path,
				headSha: "abc123",
			};

			const marker = generateCommentMarker(data);
			const parsed = parseCommentMarker(marker);

			expect(parsed?.nodePath).toBe(path);
		}
	});
});

/**
 * Create a mock GitHub client for testing.
 * Uses type assertion to bypass strict typing requirements for mocks.
 */
function createMockClient(overrides: Record<string, unknown> = {}) {
	const defaults = {
		createComment: mock(async () => ({
			id: 123,
			html_url: "https://github.com/owner/repo/pull/1#issuecomment-123",
		})),
		getIssueComments: mock(async () => []),
		updateComment: mock(async () => ({})),
	};
	return { ...defaults, ...overrides } as unknown as GitHubClient;
}

describe("postCommentsForUpdates", () => {
	test("posts one comment per update", async () => {
		const mockCreateComment = mock(async () => ({
			id: 100,
			html_url: "https://github.com/owner/repo/pull/1#issuecomment-100",
		}));

		const client = createMockClient({
			createComment: mockCreateComment,
		});

		const updates: IntentUpdate[] = [
			{
				nodePath: "packages/api/AGENTS.md",
				action: "update",
				reason: "API changes",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			{
				nodePath: "packages/core/AGENTS.md",
				action: "create",
				reason: "New package",
				suggestedContent: "# Core\n",
			},
		];

		const results = await postCommentsForUpdates(
			client,
			42,
			updates,
			"headsha123",
		);

		expect(results.length).toBe(2);
		expect(mockCreateComment).toHaveBeenCalledTimes(2);

		// Verify first comment
		expect(results[0]?.update.nodePath).toBe("packages/api/AGENTS.md");
		expect(results[0]?.commentId).toBe(100);

		// Verify second comment
		expect(results[1]?.update.nodePath).toBe("packages/core/AGENTS.md");
	});

	test("returns empty array for no updates", async () => {
		const mockCreateComment = mock(async () => ({
			id: 100,
			html_url: "https://github.com/test",
		}));

		const client = createMockClient({
			createComment: mockCreateComment,
		});

		const results = await postCommentsForUpdates(client, 42, [], "headsha123");

		expect(results.length).toBe(0);
		expect(mockCreateComment).not.toHaveBeenCalled();
	});

	test("includes correct marker in generated comments", async () => {
		let postedBody = "";
		const mockCreateComment = mock(
			async (_pullNumber: number, body: string) => {
				postedBody = body;
				return {
					id: 100,
					html_url: "https://github.com/test",
				};
			},
		);

		const client = createMockClient({
			createComment: mockCreateComment,
		});

		const updates: IntentUpdate[] = [
			{
				nodePath: "AGENTS.md",
				action: "create",
				reason: "Initialize",
				suggestedContent: "# Root\n",
			},
		];

		await postCommentsForUpdates(client, 42, updates, "abc123def");

		expect(postedBody).toContain(INTENT_LAYER_MARKER_PREFIX);
		expect(postedBody).toContain("node=AGENTS.md");
		expect(postedBody).toContain("headSha=abc123def");
		expect(postedBody).toContain("- [ ] Apply this change");
	});

	test("passes comment options to generateComment", async () => {
		let postedBody = "";
		const mockCreateComment = mock(
			async (_pullNumber: number, body: string) => {
				postedBody = body;
				return {
					id: 100,
					html_url: "https://github.com/test",
				};
			},
		);

		const client = createMockClient({
			createComment: mockCreateComment,
		});

		const updates: IntentUpdate[] = [
			{
				nodePath: "AGENTS.md",
				action: "create",
				reason: "Initialize",
				suggestedContent: "# Root\n",
			},
		];

		await postCommentsForUpdates(client, 42, updates, "abc123", {
			commentOptions: { includeCheckbox: false },
		});

		// Checkbox should NOT be present
		expect(postedBody).not.toContain("- [ ] Apply this change");
	});
});

describe("resolveAndPostComments", () => {
	test("resolves existing intent comments and posts new ones", async () => {
		const existingCommentBody = generateComment(
			{
				nodePath: "old/AGENTS.md",
				action: "update",
				reason: "Old change",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			"oldheadsha",
		);

		const mockGetIssueComments = mock(async () => [
			{ id: 1, body: existingCommentBody },
			{ id: 2, body: "Regular comment, not intent layer" },
		]);

		const updatedComments: Array<{ id: number; body: string }> = [];
		const mockUpdateComment = mock(async (commentId: number, body: string) => {
			updatedComments.push({ id: commentId, body });
			return {};
		});

		const mockCreateComment = mock(async () => ({
			id: 999,
			html_url: "https://github.com/test",
		}));

		const client = createMockClient({
			getIssueComments: mockGetIssueComments,
			updateComment: mockUpdateComment,
			createComment: mockCreateComment,
		});

		const newUpdates: IntentUpdate[] = [
			{
				nodePath: "new/AGENTS.md",
				action: "create",
				reason: "New file",
				suggestedContent: "# New\n",
			},
		];

		const result = await resolveAndPostComments(
			client,
			42,
			newUpdates,
			"newheadsha",
		);

		// Should resolve 1 existing intent comment
		expect(result.resolvedComments.length).toBe(1);
		expect(result.resolvedComments[0]?.commentId).toBe(1);
		expect(result.resolvedComments[0]?.nodePath).toBe("old/AGENTS.md");

		// Verify the comment was marked as resolved
		expect(mockUpdateComment).toHaveBeenCalledTimes(1);
		expect(updatedComments[0]?.body).toContain("**RESOLVED**");

		// Should post 1 new comment
		expect(result.postedComments.length).toBe(1);
		expect(result.postedComments[0]?.update.nodePath).toBe("new/AGENTS.md");
	});

	test("skips already resolved comments", async () => {
		const resolvedCommentBody = markCommentAsResolved(
			generateComment(
				{
					nodePath: "old/AGENTS.md",
					action: "update",
					reason: "Old change",
					currentContent: "old\n",
					suggestedContent: "new\n",
				},
				"oldheadsha",
			),
		);

		const mockGetIssueComments = mock(async () => [
			{ id: 1, body: resolvedCommentBody },
		]);

		const mockUpdateComment = mock(async () => ({}));
		const mockCreateComment = mock(async () => ({
			id: 999,
			html_url: "https://github.com/test",
		}));

		const client = createMockClient({
			getIssueComments: mockGetIssueComments,
			updateComment: mockUpdateComment,
			createComment: mockCreateComment,
		});

		const result = await resolveAndPostComments(client, 42, [], "newheadsha");

		// Should NOT resolve already-resolved comment
		expect(result.resolvedComments.length).toBe(0);
		expect(mockUpdateComment).not.toHaveBeenCalled();
	});

	test("handles PR with no existing comments", async () => {
		const mockGetIssueComments = mock(async () => []);
		const mockCreateComment = mock(async () => ({
			id: 100,
			html_url: "https://github.com/test",
		}));

		const client = createMockClient({
			getIssueComments: mockGetIssueComments,
			createComment: mockCreateComment,
		});

		const updates: IntentUpdate[] = [
			{
				nodePath: "AGENTS.md",
				action: "create",
				reason: "Initialize",
				suggestedContent: "# Root\n",
			},
		];

		const result = await resolveAndPostComments(client, 42, updates, "headsha");

		expect(result.resolvedComments.length).toBe(0);
		expect(result.postedComments.length).toBe(1);
	});

	test("handles multiple existing intent comments", async () => {
		const comment1 = generateComment(
			{
				nodePath: "packages/api/AGENTS.md",
				action: "update",
				reason: "API change",
				currentContent: "old\n",
				suggestedContent: "new\n",
			},
			"sha1",
		);

		const comment2 = generateComment(
			{
				nodePath: "packages/core/AGENTS.md",
				action: "create",
				reason: "New package",
				suggestedContent: "# Core\n",
			},
			"sha2",
		);

		const mockGetIssueComments = mock(async () => [
			{ id: 1, body: comment1 },
			{ id: 2, body: comment2 },
			{ id: 3, body: "Regular comment" },
		]);

		const mockUpdateComment = mock(async () => ({}));
		const mockCreateComment = mock(async () => ({
			id: 999,
			html_url: "https://github.com/test",
		}));

		const client = createMockClient({
			getIssueComments: mockGetIssueComments,
			updateComment: mockUpdateComment,
			createComment: mockCreateComment,
		});

		const result = await resolveAndPostComments(client, 42, [], "newsha");

		// Should resolve both intent comments
		expect(result.resolvedComments.length).toBe(2);
		expect(mockUpdateComment).toHaveBeenCalledTimes(2);
	});
});
