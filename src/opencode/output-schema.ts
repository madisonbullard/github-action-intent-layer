/**
 * LLM Output Schema
 *
 * Defines and validates the structured JSON output format expected from LLM
 * responses during intent layer analysis. The LLM produces this structure
 * to describe all proposed intent layer changes.
 */

import { z } from "zod";

/**
 * Action types for intent layer modifications:
 * - create: Create a new intent file
 * - update: Update an existing intent file
 * - delete: Remove an existing intent file (rare)
 */
export const IntentActionSchema = z.enum(["create", "update", "delete"]);
export type IntentAction = z.infer<typeof IntentActionSchema>;

/**
 * Schema for a single intent layer update proposal.
 *
 * Each update describes one proposed change to an intent file (AGENTS.md or CLAUDE.md).
 * Split operations are modeled as an `update` to the existing node + a `create` for
 * the new child node.
 */
export const IntentUpdateSchema = z
	.object({
		/** Path to the intent file (e.g., "packages/api/AGENTS.md") */
		nodePath: z.string().min(1, "nodePath is required"),

		/**
		 * Path to the corresponding other intent file when both AGENTS.md and CLAUDE.md
		 * are managed (based on `files` config). Only populated when `files: "both"`.
		 * For example, if nodePath is "packages/api/AGENTS.md", otherNodePath would be
		 * "packages/api/CLAUDE.md".
		 */
		otherNodePath: z.string().optional(),

		/** The type of action to perform */
		action: IntentActionSchema,

		/** Human-readable explanation of why this change is needed */
		reason: z.string().min(1, "reason is required"),

		/**
		 * Current content of the intent file (for update/delete actions).
		 * Required for update and delete actions; omit for create actions.
		 */
		currentContent: z.string().optional(),

		/**
		 * Suggested new content for the intent file.
		 * Required for create and update actions; omit for delete actions.
		 */
		suggestedContent: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		// Validation: create requires suggestedContent, not currentContent
		if (data.action === "create") {
			if (!data.suggestedContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "suggestedContent is required for create action",
					path: ["suggestedContent"],
				});
			}
			if (data.currentContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "currentContent should not be provided for create action",
					path: ["currentContent"],
				});
			}
		}

		// Validation: update requires both currentContent and suggestedContent
		if (data.action === "update") {
			if (!data.currentContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "currentContent is required for update action",
					path: ["currentContent"],
				});
			}
			if (!data.suggestedContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "suggestedContent is required for update action",
					path: ["suggestedContent"],
				});
			}
		}

		// Validation: delete requires currentContent, not suggestedContent
		if (data.action === "delete") {
			if (!data.currentContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "currentContent is required for delete action",
					path: ["currentContent"],
				});
			}
			if (data.suggestedContent) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "suggestedContent should not be provided for delete action",
					path: ["suggestedContent"],
				});
			}
		}
	});

export type IntentUpdate = z.infer<typeof IntentUpdateSchema>;

/**
 * Schema for the complete LLM output containing all proposed intent layer updates.
 *
 * This is the top-level structure that the LLM produces as JSON output,
 * which is then validated by the action before processing.
 */
export const LLMOutputSchema = z.object({
	/** Array of proposed intent layer updates */
	updates: z.array(IntentUpdateSchema),
});

export type LLMOutput = z.infer<typeof LLMOutputSchema>;

/**
 * Parse and validate LLM output from a JSON string.
 *
 * @param jsonString - Raw JSON string from LLM stdout
 * @returns Validated LLM output structure
 * @throws {ZodError} If the JSON is invalid or doesn't match the schema
 * @throws {SyntaxError} If the string is not valid JSON
 */
export function parseLLMOutput(jsonString: string): LLMOutput {
	const parsed = JSON.parse(jsonString);
	return LLMOutputSchema.parse(parsed);
}

/**
 * Safely parse LLM output, returning a result object instead of throwing.
 *
 * @param jsonString - Raw JSON string from LLM stdout
 * @returns Object with success status and either data or error
 */
export function safeParseLLMOutput(
	jsonString: string,
): { success: true; data: LLMOutput } | { success: false; error: string } {
	try {
		const parsed = JSON.parse(jsonString);
		const result = LLMOutputSchema.safeParse(parsed);

		if (result.success) {
			return { success: true, data: result.data };
		}

		// Format Zod error message
		const errorMessages = result.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");

		return {
			success: false,
			error: `Schema validation failed: ${errorMessages}`,
		};
	} catch (e) {
		if (e instanceof SyntaxError) {
			return { success: false, error: `Invalid JSON: ${e.message}` };
		}
		return {
			success: false,
			error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/**
 * Extract JSON from LLM output that may contain surrounding text.
 *
 * LLMs sometimes include explanatory text before/after JSON output.
 * This function attempts to extract the JSON object from such output.
 *
 * @param rawOutput - Raw output string from LLM
 * @returns Extracted JSON string, or the original string if no JSON found
 */
export function extractJSONFromOutput(rawOutput: string): string {
	const trimmed = rawOutput.trim();

	// If it already starts with { and ends with }, assume it's valid JSON
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return trimmed;
	}

	// Try to find JSON object in the output
	// Look for { "updates": pattern which is our expected structure
	const jsonMatch = trimmed.match(/\{[\s\S]*"updates"[\s\S]*\}/);
	if (jsonMatch) {
		return jsonMatch[0];
	}

	// Look for any JSON object (less specific)
	const genericMatch = trimmed.match(/\{[\s\S]*\}/);
	if (genericMatch) {
		return genericMatch[0];
	}

	// Return original if no JSON found
	return rawOutput;
}

/**
 * Parse LLM output, attempting to extract JSON if necessary.
 *
 * This is the recommended function for parsing LLM output as it handles
 * common cases where the LLM includes extra text around the JSON.
 *
 * @param rawOutput - Raw output string from LLM
 * @returns Object with success status and either data or error
 */
export function parseRawLLMOutput(
	rawOutput: string,
): { success: true; data: LLMOutput } | { success: false; error: string } {
	const jsonString = extractJSONFromOutput(rawOutput);
	return safeParseLLMOutput(jsonString);
}

/**
 * Validate that an LLM output has at least one update.
 *
 * @param output - Parsed LLM output
 * @returns True if the output contains at least one update
 */
export function hasUpdates(output: LLMOutput): boolean {
	return output.updates.length > 0;
}

/**
 * Get updates filtered by action type.
 *
 * @param output - Parsed LLM output
 * @param action - The action type to filter by
 * @returns Array of updates matching the action type
 */
export function getUpdatesByAction(
	output: LLMOutput,
	action: IntentAction,
): IntentUpdate[] {
	return output.updates.filter((update) => update.action === action);
}

/**
 * Get create updates (new intent files).
 *
 * @param output - Parsed LLM output
 * @returns Array of create updates
 */
export function getCreateUpdates(output: LLMOutput): IntentUpdate[] {
	return getUpdatesByAction(output, "create");
}

/**
 * Get update updates (modifications to existing files).
 *
 * @param output - Parsed LLM output
 * @returns Array of update updates
 */
export function getModifyUpdates(output: LLMOutput): IntentUpdate[] {
	return getUpdatesByAction(output, "update");
}

/**
 * Get delete updates (file removals).
 *
 * @param output - Parsed LLM output
 * @returns Array of delete updates
 */
export function getDeleteUpdates(output: LLMOutput): IntentUpdate[] {
	return getUpdatesByAction(output, "delete");
}

/**
 * Create an empty LLM output structure.
 * Useful for cases where no updates are needed.
 *
 * @returns Empty LLM output with no updates
 */
export function createEmptyOutput(): LLMOutput {
	return { updates: [] };
}
