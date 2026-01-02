import ignore, { type Ignore } from "ignore";

/**
 * The default filename for the intent layer ignore file
 */
export const INTENTLAYERIGNORE_FILENAME = ".intentlayerignore";

/**
 * IntentLayerIgnore wraps the `ignore` package to provide gitignore-style
 * pattern matching for excluding files from intent layer analysis and
 * token counting.
 *
 * Files matching patterns in .intentlayerignore are:
 * - Excluded from triggering intent layer updates
 * - Excluded from token budget calculations
 */
export class IntentLayerIgnore {
	private ig: Ignore;

	constructor() {
		this.ig = ignore();
	}

	/**
	 * Add patterns from a .intentlayerignore file content string
	 * @param content - The raw content of the .intentlayerignore file
	 * @returns this instance for chaining
	 */
	add(content: string): this {
		this.ig.add(content);
		return this;
	}

	/**
	 * Add patterns from an array of pattern strings
	 * @param patterns - Array of gitignore-style patterns
	 * @returns this instance for chaining
	 */
	addPatterns(patterns: string[]): this {
		this.ig.add(patterns);
		return this;
	}

	/**
	 * Check if a path should be ignored
	 * @param path - Relative path to check (forward slashes, no leading slash)
	 * @returns true if the path matches an ignore pattern
	 */
	ignores(path: string): boolean {
		return this.ig.ignores(path);
	}

	/**
	 * Filter an array of paths, returning only non-ignored paths
	 * @param paths - Array of relative paths to filter
	 * @returns Array of paths that are NOT ignored
	 */
	filter(paths: string[]): string[] {
		return this.ig.filter(paths);
	}

	/**
	 * Create a filter function for use with Array.prototype.filter
	 * @returns A function that returns true for non-ignored paths
	 */
	createFilter(): (path: string) => boolean {
		return this.ig.createFilter();
	}
}

/**
 * Parse a .intentlayerignore file content and return an IntentLayerIgnore instance
 * @param content - The raw content of the .intentlayerignore file
 * @returns IntentLayerIgnore instance configured with the patterns
 */
export function parseIntentLayerIgnore(content: string): IntentLayerIgnore {
	return new IntentLayerIgnore().add(content);
}

/**
 * Create an empty IntentLayerIgnore instance (for when no .intentlayerignore exists)
 * @returns IntentLayerIgnore instance with no patterns
 */
export function createEmptyIgnore(): IntentLayerIgnore {
	return new IntentLayerIgnore();
}
