import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ZodError, z } from "zod";

// Mock @actions/core before importing the module under test
const mockSetFailed = mock(() => {});
const mockError = mock(() => {});
const mockWarning = mock(() => {});
const mockDebug = mock(() => {});

mock.module("@actions/core", () => ({
	setFailed: mockSetFailed,
	error: mockError,
	warning: mockWarning,
	debug: mockDebug,
}));

import { InsufficientHistoryError } from "../../src/github/checkbox-handler";
import { SymlinkConflictError } from "../../src/intent/validation";
// Import after mocking
import {
	createAPIKeyError,
	createInvalidModeError,
	createLargePRError,
	createMissingEnvError,
	createMissingPRContextError,
	logLargePRSkipped,
	run,
} from "../../src/utils/errors";

describe("run", () => {
	beforeEach(() => {
		mockSetFailed.mockClear();
		mockError.mockClear();
		mockWarning.mockClear();
		mockDebug.mockClear();
	});

	test("executes function successfully without calling setFailed", async () => {
		let executed = false;
		await run(async () => {
			executed = true;
		});

		expect(executed).toBe(true);
		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("handles generic Error and calls setFailed", async () => {
		await run(async () => {
			throw new Error("Something went wrong");
		});

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockError).toHaveBeenCalledTimes(1);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Something went wrong"),
		);
	});

	test("handles string errors", async () => {
		await run(async () => {
			throw "String error message";
		});

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("String error message"),
		);
	});

	test("handles unknown error types", async () => {
		await run(async () => {
			throw { unknown: "object" };
		});

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("unexpected error"),
		);
	});

	test("formats Zod validation errors specially", async () => {
		const schema = z.object({
			mode: z.enum(["analyze", "checkbox-handler"]),
			model: z.string().min(1),
		});

		await run(async () => {
			schema.parse({ mode: "invalid", model: "" });
		});

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Configuration Validation Error"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining("mode"));
	});

	test("does not double-call setFailed for SymlinkConflictError", async () => {
		await run(async () => {
			throw new SymlinkConflictError("Conflict detected", ["dir1"]);
		});

		// Should not call setFailed because SymlinkConflictError already does
		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockDebug).toHaveBeenCalledWith(
			expect.stringContaining("Error already handled"),
		);
	});

	test("does not double-call setFailed for InsufficientHistoryError", async () => {
		await run(async () => {
			throw new InsufficientHistoryError("History insufficient", "abc123");
		});

		// Should not call setFailed because InsufficientHistoryError already does
		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockDebug).toHaveBeenCalledWith(
			expect.stringContaining("Error already handled"),
		);
	});

	test("includes action name in error message", async () => {
		await run(
			async () => {
				throw new Error("Test error");
			},
			{ actionName: "Custom Action Name" },
		);

		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Custom Action Name Failed"),
		);
	});

	test("uses default action name when not specified", async () => {
		await run(async () => {
			throw new Error("Test error");
		});

		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Intent Layer Action Failed"),
		);
	});
});

describe("createMissingEnvError", () => {
	test("creates error with variable name and description", () => {
		const error = createMissingEnvError(
			"GITHUB_TOKEN",
			"is required for GitHub API access",
		);

		expect(error.message).toContain("GITHUB_TOKEN");
		expect(error.message).toContain("is required for GitHub API access");
		expect(error.message).toContain("workflow configuration");
	});
});

describe("createInvalidModeError", () => {
	test("creates error with invalid mode and valid options", () => {
		const error = createInvalidModeError("invalid-mode", [
			"analyze",
			"checkbox-handler",
		]);

		expect(error.message).toContain("invalid-mode");
		expect(error.message).toContain("analyze");
		expect(error.message).toContain("checkbox-handler");
	});
});

describe("createMissingPRContextError", () => {
	test("creates error with pull request context guidance", () => {
		const error = createMissingPRContextError();

		expect(error.message).toContain("pull request context");
		expect(error.message).toContain("pull_request");
		expect(error.message).toContain("issue_comment");
	});
});

describe("createAPIKeyError", () => {
	test("creates error with provider and env var guidance", () => {
		const error = createAPIKeyError("Anthropic", "ANTHROPIC_API_KEY");

		expect(error.message).toContain("Anthropic");
		expect(error.message).toContain("ANTHROPIC_API_KEY");
		expect(error.message).toContain("repository secret");
		expect(error.message).toContain("Settings");
	});

	test("creates error for OpenRouter", () => {
		const error = createAPIKeyError("OpenRouter", "OPENROUTER_API_KEY");

		expect(error.message).toContain("OpenRouter");
		expect(error.message).toContain("OPENROUTER_API_KEY");
	});
});

describe("createLargePRError", () => {
	test("creates error with line counts", () => {
		const error = createLargePRError(150000, 100000);

		expect(error.message).toContain("150,000");
		expect(error.message).toContain("100,000");
		expect(error.message).toContain("exceeds");
	});
});

describe("logLargePRSkipped", () => {
	beforeEach(() => {
		mockWarning.mockClear();
		mockSetFailed.mockClear();
	});

	test("logs warning instead of error for large PR", () => {
		logLargePRSkipped(150000, 100000);

		expect(mockWarning).toHaveBeenCalledTimes(1);
		expect(mockWarning).toHaveBeenCalledWith(
			expect.stringContaining("Skipping"),
		);
		expect(mockWarning).toHaveBeenCalledWith(
			expect.stringContaining("150,000"),
		);
		expect(mockSetFailed).not.toHaveBeenCalled();
	});
});
