/**
 * Centralized OpenCode response mocks for testing.
 *
 * This module provides mock factories and helpers for testing OpenCode/LLM output.
 * Use these mocks in unit and integration tests to avoid real LLM calls.
 *
 * The mocks conform to the LLMOutput schema defined in src/opencode/output-schema.ts.
 */

import type {
	IntentAction,
	IntentUpdate,
	LLMOutput,
} from "../../src/opencode/output-schema";

/**
 * Scenario types for mock OpenCode responses.
 * - update: Single update to an existing intent file
 * - create: Create a new intent file
 * - delete: Delete an existing intent file
 * - no-changes: No updates needed
 * - multiple-updates: Multiple updates in a single response
 */
export type MockScenario =
	| "update"
	| "create"
	| "delete"
	| "no-changes"
	| "multiple-updates";

/**
 * Options for customizing mock responses.
 */
export interface MockOpenCodeOptions {
	/** Custom node path (default depends on scenario) */
	nodePath?: string;
	/** Custom other node path for symlink scenarios */
	otherNodePath?: string;
	/** Custom reason (default: generated from scenario) */
	reason?: string;
	/** Custom current content (for update/delete) */
	currentContent?: string;
	/** Custom suggested content (for update/create) */
	suggestedContent?: string;
}

/**
 * Create a mock OpenCode response for a given scenario.
 *
 * @param scenario - The type of mock response to generate
 * @param options - Optional customizations for the response
 * @returns A valid LLMOutput object matching the schema
 *
 * @example
 * ```typescript
 * // Get a simple update response
 * const response = mockOpenCodeResponse('update');
 *
 * // Customize the response
 * const customResponse = mockOpenCodeResponse('create', {
 *   nodePath: 'packages/api/AGENTS.md',
 *   suggestedContent: '# Custom API Guidelines\n...',
 * });
 * ```
 */
export function mockOpenCodeResponse(
	scenario: MockScenario,
	options: MockOpenCodeOptions = {},
): LLMOutput {
	switch (scenario) {
		case "update":
			return createUpdateResponse(options);
		case "create":
			return createCreateResponse(options);
		case "delete":
			return createDeleteResponse(options);
		case "no-changes":
			return { updates: [] };
		case "multiple-updates":
			return createMultipleUpdatesResponse(options);
		default:
			throw new Error(`Unknown mock scenario: ${scenario}`);
	}
}

/**
 * Create a mock IntentUpdate object for a specific action.
 * Useful for building custom test scenarios.
 *
 * @param action - The action type (create, update, delete)
 * @param overrides - Custom fields to override defaults
 * @returns A valid IntentUpdate object
 */
export function mockIntentUpdate(
	action: IntentAction,
	overrides: Partial<IntentUpdate> = {},
): IntentUpdate {
	const defaults = getDefaultsForAction(action);
	return {
		...defaults,
		...overrides,
	};
}

/**
 * Create a mock response for updating an existing intent file.
 */
function createUpdateResponse(options: MockOpenCodeOptions): LLMOutput {
	return {
		updates: [
			{
				nodePath: options.nodePath ?? "AGENTS.md",
				otherNodePath: options.otherNodePath,
				action: "update",
				reason:
					options.reason ??
					"Update guidelines to reflect new API patterns introduced in this PR",
				currentContent:
					options.currentContent ?? "# Existing Guidelines\n\nCurrent content.",
				suggestedContent:
					options.suggestedContent ??
					"# Updated Guidelines\n\nNew content with improved patterns.",
			},
		],
	};
}

/**
 * Create a mock response for creating a new intent file.
 */
function createCreateResponse(options: MockOpenCodeOptions): LLMOutput {
	return {
		updates: [
			{
				nodePath: options.nodePath ?? "packages/new-feature/AGENTS.md",
				otherNodePath: options.otherNodePath,
				action: "create",
				reason:
					options.reason ??
					"Create new intent file for the new-feature package",
				suggestedContent:
					options.suggestedContent ??
					"# New Feature Guidelines\n\nGuidelines for the new feature package.",
			},
		],
	};
}

/**
 * Create a mock response for deleting an intent file.
 */
function createDeleteResponse(options: MockOpenCodeOptions): LLMOutput {
	return {
		updates: [
			{
				nodePath: options.nodePath ?? "packages/deprecated/AGENTS.md",
				otherNodePath: options.otherNodePath,
				action: "delete",
				reason:
					options.reason ??
					"Remove intent file for deprecated package being deleted",
				currentContent:
					options.currentContent ??
					"# Deprecated Guidelines\n\nThis package is no longer maintained.",
			},
		],
	};
}

/**
 * Create a mock response with multiple updates.
 * Demonstrates a realistic scenario with various operations.
 */
function createMultipleUpdatesResponse(
	options: MockOpenCodeOptions,
): LLMOutput {
	return {
		updates: [
			{
				nodePath: "AGENTS.md",
				action: "update",
				reason:
					options.reason ?? "Update root guidelines to reference new package",
				currentContent:
					options.currentContent ?? "# Root Guidelines\n\nOriginal content.",
				suggestedContent:
					options.suggestedContent ??
					"# Root Guidelines\n\nUpdated to reference new-feature package.",
			},
			{
				nodePath: "packages/new-feature/AGENTS.md",
				action: "create",
				reason: "Create intent file for new package",
				suggestedContent:
					"# New Feature Guidelines\n\nSpecific guidelines for new-feature.",
			},
			{
				nodePath: "packages/legacy/AGENTS.md",
				action: "update",
				reason: "Update legacy package to mark deprecation notice",
				currentContent: "# Legacy Guidelines\n\nOld patterns.",
				suggestedContent:
					"# Legacy Guidelines (Deprecated)\n\nThis package is deprecated. See new-feature instead.",
			},
		],
	};
}

/**
 * Get default values for a given action type.
 */
function getDefaultsForAction(action: IntentAction): IntentUpdate {
	switch (action) {
		case "create":
			return {
				nodePath: "new/AGENTS.md",
				action: "create",
				reason: "Create new intent file",
				suggestedContent: "# New Guidelines\n\nContent here.",
			};
		case "update":
			return {
				nodePath: "AGENTS.md",
				action: "update",
				reason: "Update existing intent file",
				currentContent: "# Current\n\nOld content.",
				suggestedContent: "# Updated\n\nNew content.",
			};
		case "delete":
			return {
				nodePath: "deprecated/AGENTS.md",
				action: "delete",
				reason: "Delete deprecated intent file",
				currentContent: "# Deprecated\n\nContent to remove.",
			};
		default:
			throw new Error(`Unknown action: ${action}`);
	}
}

/**
 * Pre-built mock responses for common test scenarios.
 * Use these for quick setup in tests.
 */
export const mockResponses = {
	/** Empty response - no changes needed */
	noChanges: (): LLMOutput => ({ updates: [] }),

	/** Single create operation */
	singleCreate: (
		nodePath = "AGENTS.md",
		suggestedContent = "# Guidelines\n\nNew content.",
	): LLMOutput => ({
		updates: [
			{
				nodePath,
				action: "create",
				reason: "Create new intent file",
				suggestedContent,
			},
		],
	}),

	/** Single update operation */
	singleUpdate: (
		nodePath = "AGENTS.md",
		currentContent = "# Old\n\nOld content.",
		suggestedContent = "# New\n\nNew content.",
	): LLMOutput => ({
		updates: [
			{
				nodePath,
				action: "update",
				reason: "Update intent file",
				currentContent,
				suggestedContent,
			},
		],
	}),

	/** Single delete operation */
	singleDelete: (
		nodePath = "deprecated/AGENTS.md",
		currentContent = "# Deprecated\n\nContent to remove.",
	): LLMOutput => ({
		updates: [
			{
				nodePath,
				action: "delete",
				reason: "Delete deprecated intent file",
				currentContent,
			},
		],
	}),

	/** Update with symlink (both AGENTS.md and CLAUDE.md) */
	updateWithSymlink: (basePath = "packages/api"): LLMOutput => ({
		updates: [
			{
				nodePath: `${basePath}/AGENTS.md`,
				otherNodePath: `${basePath}/CLAUDE.md`,
				action: "update",
				reason: "Update package guidelines",
				currentContent: "# API Guidelines\n\nCurrent.",
				suggestedContent: "# API Guidelines\n\nUpdated.",
			},
		],
	}),

	/** Create with symlink (both AGENTS.md and CLAUDE.md) */
	createWithSymlink: (basePath = "packages/new"): LLMOutput => ({
		updates: [
			{
				nodePath: `${basePath}/AGENTS.md`,
				otherNodePath: `${basePath}/CLAUDE.md`,
				action: "create",
				reason: "Create new package guidelines",
				suggestedContent: "# New Package Guidelines\n\nContent.",
			},
		],
	}),
};

/**
 * Convert an LLMOutput to a JSON string as it would be returned from OpenCode.
 * Useful for testing JSON parsing.
 */
export function mockRawOutput(response: LLMOutput): string {
	return JSON.stringify(response, null, 2);
}

/**
 * Create a raw output string with surrounding text (like LLM might produce).
 * Useful for testing extractJSONFromOutput.
 */
export function mockRawOutputWithSurroundingText(response: LLMOutput): string {
	return `Here's my analysis of the changes:\n\n${JSON.stringify(response, null, 2)}\n\nLet me know if you need anything else!`;
}
