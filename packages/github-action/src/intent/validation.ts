/**
 * Intent Layer Validation
 *
 * Validates intent layer configuration against the repository state
 * and handles error reporting for GitHub Actions.
 */

import * as core from "@actions/core";
import {
	type IntentLayerDetectionResult,
	type SymlinkValidationResult,
	validateSymlinkConfig,
} from "./detector";

/**
 * Error class for symlink configuration conflicts.
 *
 * This error is thrown when the symlink configuration in the action
 * conflicts with the actual state of intent files in the repository.
 */
export class SymlinkConflictError extends Error {
	/** Directories where conflicts were detected */
	readonly conflictDirectories: string[];

	constructor(message: string, conflictDirectories: string[]) {
		super(message);
		this.name = "SymlinkConflictError";
		this.conflictDirectories = conflictDirectories;
	}
}

/**
 * Validate symlink configuration and fail the action if there's a conflict.
 *
 * This function checks if the `symlink: true` configuration is compatible
 * with the actual state of AGENTS.md and CLAUDE.md files in the repository.
 * If both files exist in the same directory but neither is a symlink to the
 * other, this is a configuration conflict that must be resolved by the user.
 *
 * When a conflict is detected:
 * 1. Logs a detailed error message with affected directories
 * 2. Fails the GitHub Action using `core.setFailed()`
 * 3. Throws a SymlinkConflictError for programmatic handling
 *
 * Per PLAN.md task 12.2:
 * "Handle symlink conflict → fail action with clear error message"
 *
 * @param detectionResult - The result from detecting intent layer files
 * @param symlinkEnabled - Whether `symlink: true` is configured
 * @throws SymlinkConflictError if validation fails
 */
export function validateAndFailOnSymlinkConflict(
	detectionResult: IntentLayerDetectionResult,
	symlinkEnabled: boolean,
): void {
	const validation = validateSymlinkConfig(detectionResult, symlinkEnabled);

	if (!validation.valid) {
		// Build a detailed error message for the user
		const errorMessage = formatSymlinkConflictError(validation);

		// Log the error for debugging
		core.error(errorMessage);

		// Fail the GitHub Action with clear message
		core.setFailed(errorMessage);

		// Throw an error for programmatic handling
		throw new SymlinkConflictError(
			validation.error ?? "Symlink configuration conflict detected",
			validation.conflictDirectories ?? [],
		);
	}
}

/**
 * Format a detailed error message for symlink configuration conflicts.
 *
 * @param validation - The validation result containing error details
 * @returns Formatted error message with resolution steps
 */
function formatSymlinkConflictError(
	validation: SymlinkValidationResult,
): string {
	const lines: string[] = [];

	lines.push("Intent Layer Symlink Configuration Error");
	lines.push("");
	lines.push(validation.error ?? "Symlink configuration conflict detected.");
	lines.push("");
	lines.push("Resolution options:");
	lines.push(
		"  1. Convert one file to a symlink: Delete either AGENTS.md or CLAUDE.md and replace it with a symlink to the other",
	);
	lines.push(
		"  2. Keep both files separate: Set 'symlink: false' in your action configuration",
	);
	lines.push(
		"  3. Remove duplicate: If both files have the same content, delete one and keep the other",
	);
	lines.push("");

	if (
		validation.conflictDirectories &&
		validation.conflictDirectories.length > 0
	) {
		lines.push("Affected directories:");
		for (const dir of validation.conflictDirectories) {
			const displayDir = dir === "(root)" ? "Repository root" : dir;
			lines.push(`  - ${displayDir}`);
		}
	}

	return lines.join("\n");
}

/**
 * Check symlink configuration without failing the action.
 *
 * Use this function when you want to check for conflicts but handle
 * the error yourself rather than immediately failing the action.
 *
 * @param detectionResult - The result from detecting intent layer files
 * @param symlinkEnabled - Whether `symlink: true` is configured
 * @returns Validation result with details about any conflicts
 */
export function checkSymlinkConfig(
	detectionResult: IntentLayerDetectionResult,
	symlinkEnabled: boolean,
): SymlinkValidationResult {
	return validateSymlinkConfig(detectionResult, symlinkEnabled);
}
