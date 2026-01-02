import { z } from "zod";

/**
 * Operation mode for the action:
 * - analyze: Run LLM analysis on PR changes and output results
 * - checkbox-handler: Handle checkbox toggles in PR comments
 */
export const ModeSchema = z.enum(["analyze", "checkbox-handler"]);
export type Mode = z.infer<typeof ModeSchema>;

/**
 * Which intent layer files to manage:
 * - agents: Only AGENTS.md files
 * - claude: Only CLAUDE.md files
 * - both: Both AGENTS.md and CLAUDE.md files
 */
export const FilesSchema = z.enum(["agents", "claude", "both"]);
export type Files = z.infer<typeof FilesSchema>;

/**
 * Symlink source of truth when symlinking is enabled:
 * - agents: AGENTS.md is the source, CLAUDE.md is symlinked
 * - claude: CLAUDE.md is the source, AGENTS.md is symlinked
 */
export const SymlinkSourceSchema = z.enum(["agents", "claude"]);
export type SymlinkSource = z.infer<typeof SymlinkSourceSchema>;

/**
 * Output mode for analyze results:
 * - pr_comments: Post per-node comments with approval checkboxes
 * - pr_commit: Apply all changes immediately in a single commit
 * - new_pr: Open a new PR with all proposed changes
 */
export const OutputSchema = z.enum(["pr_comments", "pr_commit", "new_pr"]);
export type Output = z.infer<typeof OutputSchema>;

/**
 * Schema for a single pattern-matched prompt configuration
 */
export const PromptConfigSchema = z.object({
	/** Glob pattern to match files */
	pattern: z.string(),
	/** General prompt for all file types */
	prompt: z.string().optional(),
	/** Specific prompt for AGENTS.md files */
	agents_prompt: z.string().optional(),
	/** Specific prompt for CLAUDE.md files */
	claude_prompt: z.string().optional(),
});
export type PromptConfig = z.infer<typeof PromptConfigSchema>;

/**
 * Helper to coerce string "true"/"false" to boolean
 * GitHub Action inputs are always strings, so we need to handle this
 */
const booleanFromString = z
	.union([z.boolean(), z.string()])
	.transform((val) => {
		if (typeof val === "boolean") return val;
		return val.toLowerCase() === "true";
	});

/**
 * Helper to coerce string to number
 * GitHub Action inputs are always strings
 */
const numberFromString = z.union([z.number(), z.string()]).transform((val) => {
	if (typeof val === "number") return val;
	const parsed = Number(val);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid number: ${val}`);
	}
	return parsed;
});

/**
 * Schema for pattern-matched prompts input (YAML string or parsed array)
 * Returns: PromptConfig[] if empty/whitespace string or array provided
 *          string if non-empty YAML string (for later parsing)
 */
const promptsFromInput = z
	.union([z.string(), z.array(PromptConfigSchema), z.undefined()])
	.transform((val): string | PromptConfig[] => {
		// Handle undefined (default case)
		if (val === undefined) return [];
		if (typeof val === "string") {
			// Empty string means no prompts
			if (!val.trim()) return [];
			// YAML parsing will be handled at runtime by the prompts module
			// For now, we just pass through the string for later parsing
			return val;
		}
		return val;
	});

/**
 * Main schema for all GitHub Action inputs
 */
export const ActionInputsSchema = z.object({
	/** Operation mode */
	mode: ModeSchema.default("analyze"),

	/** Model to use (provider/model format) */
	model: z.string().default("anthropic/claude-sonnet-4-20250514"),

	/** Which files to manage */
	files: FilesSchema.default("agents"),

	/** Create symlinks between AGENTS.md and CLAUDE.md */
	symlink: booleanFromString.default(false),

	/** Which file is source of truth when symlinking */
	symlink_source: SymlinkSourceSchema.default("agents"),

	/** Output mode for analyze results */
	output: OutputSchema.default("pr_comments"),

	/** Allow new node creation */
	new_nodes: booleanFromString.default(true),

	/** Automatically suggest splitting large nodes */
	split_large_nodes: booleanFromString.default(true),

	/** Max token budget as percentage of covered code */
	token_budget_percent: numberFromString.default(5),

	/** Skip token counting for binary files */
	skip_binary_files: booleanFromString.default(true),

	/** Skip token counting for files exceeding this many lines */
	file_max_lines: numberFromString.default(8000),

	/** Pattern-matched custom prompts (YAML string or parsed array) */
	prompts: promptsFromInput.optional(),
});

export type ActionInputs = z.infer<typeof ActionInputsSchema>;

/**
 * Parse and validate action inputs with defaults applied
 * @param rawInputs - Raw inputs from GitHub Action (all strings)
 * @returns Validated and typed action inputs
 */
export function parseActionInputs(
	rawInputs: Record<string, string | undefined>,
): ActionInputs {
	// Filter out undefined values and let Zod apply defaults
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(rawInputs)) {
		if (value !== undefined && value !== "") {
			filtered[key] = value;
		}
	}

	return ActionInputsSchema.parse(filtered);
}
