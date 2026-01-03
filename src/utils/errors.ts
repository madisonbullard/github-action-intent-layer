/**
 * Error Handling Utilities
 *
 * Provides utilities for wrapping the main action with comprehensive error
 * handling. Ensures that all errors are caught and the action fails cleanly
 * with informative error messages.
 *
 * Per PLAN.md task 12.7:
 * "Ensure action fails cleanly with informative error messages"
 */

import * as core from "@actions/core";
import { ZodError } from "zod";
import { InsufficientHistoryError } from "../github/checkbox-handler.js";
import { SymlinkConflictError } from "../intent/validation.js";

/**
 * Known error types that have special handling.
 */
export type KnownError =
	| ZodError
	| SymlinkConflictError
	| InsufficientHistoryError
	| Error;

/**
 * Options for the run wrapper.
 */
export interface RunOptions {
	/** Action name for logging purposes (default: "Intent Layer Action") */
	actionName?: string;
}

/**
 * Format a Zod validation error into a user-friendly message.
 *
 * @param error - The Zod validation error
 * @returns Formatted error message
 */
function formatZodError(error: ZodError): string {
	const lines: string[] = [];

	lines.push("Configuration Validation Error");
	lines.push("");
	lines.push("One or more action inputs are invalid:");
	lines.push("");

	for (const issue of error.issues) {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		lines.push(`  - ${path}: ${issue.message}`);
	}

	lines.push("");
	lines.push(
		"Please check your workflow configuration and ensure all inputs are valid.",
	);

	return lines.join("\n");
}

/**
 * Format an unknown error into a user-friendly message.
 *
 * @param error - The error that occurred
 * @param actionName - Name of the action for context
 * @returns Formatted error message
 */
function formatUnknownError(error: unknown, actionName: string): string {
	const lines: string[] = [];

	lines.push(`${actionName} Failed`);
	lines.push("");

	if (error instanceof Error) {
		lines.push(error.message);

		// Include stack trace in debug output
		if (error.stack) {
			core.debug(`Stack trace: ${error.stack}`);
		}
	} else if (typeof error === "string") {
		lines.push(error);
	} else {
		lines.push("An unexpected error occurred.");
		core.debug(`Unknown error type: ${JSON.stringify(error)}`);
	}

	return lines.join("\n");
}

/**
 * Determine if an error has already been handled by setFailed.
 *
 * Some error types (like SymlinkConflictError and InsufficientHistoryError)
 * are thrown after calling setFailed. We detect these to avoid calling
 * setFailed twice.
 *
 * @param error - The error to check
 * @returns True if the error has already been handled
 */
function isAlreadyHandledError(error: unknown): boolean {
	return (
		error instanceof SymlinkConflictError ||
		error instanceof InsufficientHistoryError
	);
}

/**
 * Wrap an async action function with comprehensive error handling.
 *
 * This function should be used as the main wrapper for the action entry point.
 * It catches all errors and ensures:
 * 1. The action fails with an appropriate exit code
 * 2. Error messages are clear and actionable
 * 3. Different error types get appropriate handling
 *
 * Usage:
 * ```typescript
 * import { run } from "./utils/errors";
 *
 * run(async () => {
 *   // Main action logic here
 * });
 * ```
 *
 * @param fn - The async function to run
 * @param options - Optional configuration
 */
export async function run(
	fn: () => Promise<void>,
	options: RunOptions = {},
): Promise<void> {
	const actionName = options.actionName ?? "Intent Layer Action";

	try {
		await fn();
	} catch (error) {
		// Check if this error has already been handled (setFailed already called)
		if (isAlreadyHandledError(error)) {
			// Error has already called setFailed, just re-throw to ensure process exit
			// The action will exit with a non-zero code
			core.debug(
				`Error already handled: ${error instanceof Error ? error.name : "unknown"}`,
			);
			return;
		}

		// Handle Zod validation errors specially
		if (error instanceof ZodError) {
			const message = formatZodError(error);
			core.error(message);
			core.setFailed(message);
			return;
		}

		// Handle all other errors
		const message = formatUnknownError(error, actionName);
		core.error(message);
		core.setFailed(message);
	}
}

/**
 * Create a formatted error for missing required environment variables.
 *
 * @param variableName - Name of the missing environment variable
 * @param description - Description of what the variable is used for
 * @returns Error with a helpful message
 */
export function createMissingEnvError(
	variableName: string,
	description: string,
): Error {
	const message = [
		`Missing required environment variable: ${variableName}`,
		"",
		`${variableName} ${description}`,
		"",
		"Please ensure this variable is set in your workflow configuration.",
	].join("\n");

	return new Error(message);
}

/**
 * Create a formatted error for invalid mode configuration.
 *
 * @param mode - The invalid mode value
 * @param validModes - List of valid mode values
 * @returns Error with a helpful message
 */
export function createInvalidModeError(
	mode: string,
	validModes: string[],
): Error {
	const message = [
		`Invalid mode: "${mode}"`,
		"",
		`Valid modes are: ${validModes.join(", ")}`,
		"",
		"Please check your workflow configuration.",
	].join("\n");

	return new Error(message);
}

/**
 * Create a formatted error for missing PR context.
 *
 * @returns Error with a helpful message
 */
export function createMissingPRContextError(): Error {
	const message = [
		"Missing pull request context",
		"",
		"This action must be run in the context of a pull request.",
		"Ensure your workflow is triggered by pull_request or issue_comment events.",
		"",
		"Example workflow configuration:",
		"  on:",
		"    pull_request:",
		"      types: [opened, synchronize, edited]",
	].join("\n");

	return new Error(message);
}

/**
 * Create a formatted error for API key issues.
 *
 * @param provider - The API provider (e.g., "Anthropic", "OpenRouter")
 * @param envVarName - Name of the environment variable
 * @returns Error with a helpful message
 */
export function createAPIKeyError(provider: string, envVarName: string): Error {
	const message = [
		`Missing or invalid ${provider} API key`,
		"",
		`Please configure ${envVarName} as a repository secret.`,
		"",
		"Steps to configure:",
		"  1. Go to your repository Settings > Secrets and variables > Actions",
		`  2. Click 'New repository secret'`,
		`  3. Name: ${envVarName}`,
		`  4. Value: Your ${provider} API key`,
		"  5. Click 'Add secret'",
		"",
		"Then reference it in your workflow:",
		"  env:",
		`    ${envVarName}: \${{ secrets.${envVarName} }}`,
	].join("\n");

	return new Error(message);
}

/**
 * Create a formatted error for large PR threshold exceeded.
 *
 * @param linesChanged - Number of lines changed in the PR
 * @param maxLines - Maximum allowed lines
 * @returns Error with a helpful message
 */
export function createLargePRError(
	linesChanged: number,
	maxLines: number,
): Error {
	const message = [
		"PR exceeds maximum size threshold",
		"",
		`This PR has ${linesChanged.toLocaleString()} lines changed, which exceeds the maximum of ${maxLines.toLocaleString()} lines.`,
		"",
		"The intent layer analysis has been skipped for this PR.",
		"Consider breaking this PR into smaller, more focused changes.",
	].join("\n");

	return new Error(message);
}

/**
 * Log an informational message about skipping a large PR (non-failure case).
 *
 * Per PLAN.md section 17, large PRs should exit early with an informational
 * message (not a failure). Use this function instead of createLargePRError
 * when you want to skip without failing.
 *
 * @param linesChanged - Number of lines changed in the PR
 * @param maxLines - Maximum allowed lines
 */
export function logLargePRSkipped(
	linesChanged: number,
	maxLines: number,
): void {
	const message = [
		"Skipping intent layer analysis for large PR",
		"",
		`This PR has ${linesChanged.toLocaleString()} lines changed, which exceeds the maximum of ${maxLines.toLocaleString()} lines.`,
		"",
		"The intent layer analysis has been skipped.",
		"Consider breaking large PRs into smaller, more focused changes for better intent layer coverage.",
	].join("\n");

	core.warning(message);
}
