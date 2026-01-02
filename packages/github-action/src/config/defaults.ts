import type { Files, Mode, Output, SymlinkSource } from "./schema";

/**
 * Default configuration values for the Intent Layer GitHub Action.
 * These values match the defaults specified in action.yml and are used
 * by the Zod schema for validation.
 */
export const DEFAULTS = {
	/** Default operation mode */
	mode: "analyze" as Mode,

	/** Default model to use (provider/model format) */
	model: "anthropic/claude-sonnet-4-20250514",

	/** Default file management mode */
	files: "agents" as Files,

	/** Default symlink setting */
	symlink: false,

	/** Default symlink source of truth */
	symlinkSource: "agents" as SymlinkSource,

	/** Default output mode */
	output: "pr_comments" as Output,

	/** Default new node creation setting */
	newNodes: true,

	/** Default split large nodes setting */
	splitLargeNodes: true,

	/** Default token budget percentage */
	tokenBudgetPercent: 5,

	/** Default skip binary files setting */
	skipBinaryFiles: true,

	/** Default maximum file lines to process */
	fileMaxLines: 8000,
} as const;

/**
 * Maximum lines changed in a PR before skipping analysis entirely.
 * PRs exceeding this threshold exit early with an informational message.
 */
export const MAX_PR_LINES_CHANGED = 100_000;
