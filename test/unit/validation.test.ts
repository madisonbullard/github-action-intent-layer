import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { IntentLayerDetectionResult } from "../../src/intent/detector";
import {
	checkSymlinkConfig,
	SymlinkConflictError,
	validateAndFailOnSymlinkConflict,
	validatePlatformForSymlink,
	WindowsSymlinkError,
} from "../../src/intent/validation";

// Mock @actions/core
const mockSetFailed = mock(() => {});
const mockError = mock(() => {});

mock.module("@actions/core", () => ({
	setFailed: mockSetFailed,
	error: mockError,
}));

describe("validateAndFailOnSymlinkConflict", () => {
	beforeEach(() => {
		mockSetFailed.mockClear();
		mockError.mockClear();
	});

	test("does not fail when symlink is disabled", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		// Should not throw
		expect(() => {
			validateAndFailOnSymlinkConflict(result, false);
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("does not fail when symlink enabled and files are properly symlinked", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{
					path: "CLAUDE.md",
					type: "claude",
					sha: "sha2",
					isSymlink: true,
					symlinkTarget: "AGENTS.md",
				},
			],
		};

		// Should not throw
		expect(() => {
			validateAndFailOnSymlinkConflict(result, true);
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("does not fail when symlink enabled and only one file exists", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [],
		};

		// Should not throw
		expect(() => {
			validateAndFailOnSymlinkConflict(result, true);
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("fails action when symlink enabled but both files exist without symlink", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		// Should throw
		expect(() => {
			validateAndFailOnSymlinkConflict(result, true);
		}).toThrow(SymlinkConflictError);

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockError).toHaveBeenCalledTimes(1);
	});

	test("error message includes affected directories", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
				{
					path: "packages/api/AGENTS.md",
					type: "agents",
					sha: "sha3",
					isSymlink: false,
				},
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
				{
					path: "packages/api/CLAUDE.md",
					type: "claude",
					sha: "sha4",
					isSymlink: false,
				},
			],
		};

		try {
			validateAndFailOnSymlinkConflict(result, true);
		} catch (error) {
			if (error instanceof SymlinkConflictError) {
				expect(error.conflictDirectories).toContain("(root)");
				expect(error.conflictDirectories).toContain("packages/api");
			} else {
				throw error;
			}
		}

		// Verify setFailed was called with a message containing directory info
		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		// Use toHaveBeenCalledWith with expect.stringContaining
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Repository root"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("packages/api"),
		);
	});

	test("error message includes resolution options", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		try {
			validateAndFailOnSymlinkConflict(result, true);
		} catch {
			// Expected
		}

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Resolution options"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("symlink: false"),
		);
	});

	test("throws SymlinkConflictError with correct properties", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		let thrownError: SymlinkConflictError | undefined;
		try {
			validateAndFailOnSymlinkConflict(result, true);
		} catch (error) {
			if (error instanceof SymlinkConflictError) {
				thrownError = error;
			}
		}

		expect(thrownError).toBeDefined();
		expect(thrownError?.name).toBe("SymlinkConflictError");
		expect(thrownError?.conflictDirectories).toEqual(["(root)"]);
		expect(thrownError?.message).toContain("Symlink configuration conflict");
	});
});

describe("checkSymlinkConfig", () => {
	test("returns valid result when symlink is disabled", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		const validation = checkSymlinkConfig(result, false);

		expect(validation.valid).toBe(true);
		expect(validation.error).toBeUndefined();
	});

	test("returns valid result when symlink enabled and properly configured", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{
					path: "AGENTS.md",
					type: "agents",
					sha: "sha1",
					isSymlink: true,
					symlinkTarget: "CLAUDE.md",
				},
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		const validation = checkSymlinkConfig(result, true);

		expect(validation.valid).toBe(true);
	});

	test("returns invalid result with error details on conflict", () => {
		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		const validation = checkSymlinkConfig(result, true);

		expect(validation.valid).toBe(false);
		expect(validation.error).toBeDefined();
		expect(validation.conflictDirectories).toEqual(["(root)"]);
	});

	test("does not call core.setFailed (unlike validateAndFailOnSymlinkConflict)", () => {
		mockSetFailed.mockClear();

		const result: IntentLayerDetectionResult = {
			agentsFiles: [
				{ path: "AGENTS.md", type: "agents", sha: "sha1", isSymlink: false },
			],
			claudeFiles: [
				{ path: "CLAUDE.md", type: "claude", sha: "sha2", isSymlink: false },
			],
		};

		const validation = checkSymlinkConfig(result, true);

		// Should return invalid but NOT call setFailed
		expect(validation.valid).toBe(false);
		expect(mockSetFailed).not.toHaveBeenCalled();
	});
});

describe("SymlinkConflictError", () => {
	test("has correct name property", () => {
		const error = new SymlinkConflictError("test message", ["dir1", "dir2"]);
		expect(error.name).toBe("SymlinkConflictError");
	});

	test("stores conflict directories", () => {
		const error = new SymlinkConflictError("test message", [
			"(root)",
			"packages/api",
		]);
		expect(error.conflictDirectories).toEqual(["(root)", "packages/api"]);
	});

	test("stores error message", () => {
		const error = new SymlinkConflictError("Custom error message", []);
		expect(error.message).toBe("Custom error message");
	});

	test("is an instance of Error", () => {
		const error = new SymlinkConflictError("test", []);
		expect(error instanceof Error).toBe(true);
		expect(error instanceof SymlinkConflictError).toBe(true);
	});
});

describe("validatePlatformForSymlink", () => {
	beforeEach(() => {
		mockSetFailed.mockClear();
		mockError.mockClear();
	});

	test("does not fail when symlink is disabled on Windows", () => {
		// Should not throw when symlink is disabled, even on Windows
		expect(() => {
			validatePlatformForSymlink(false, "win32");
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("does not fail when symlink is enabled on Linux", () => {
		// Should not throw when on Linux
		expect(() => {
			validatePlatformForSymlink(true, "linux");
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("does not fail when symlink is enabled on macOS", () => {
		// Should not throw when on macOS
		expect(() => {
			validatePlatformForSymlink(true, "darwin");
		}).not.toThrow();

		expect(mockSetFailed).not.toHaveBeenCalled();
		expect(mockError).not.toHaveBeenCalled();
	});

	test("fails action when symlink is enabled on Windows", () => {
		// Should throw WindowsSymlinkError
		expect(() => {
			validatePlatformForSymlink(true, "win32");
		}).toThrow(WindowsSymlinkError);

		expect(mockSetFailed).toHaveBeenCalledTimes(1);
		expect(mockError).toHaveBeenCalledTimes(1);
	});

	test("error message includes platform information", () => {
		try {
			validatePlatformForSymlink(true, "win32");
		} catch {
			// Expected
		}

		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Windows"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("elevated permissions"),
		);
	});

	test("error message includes resolution options", () => {
		try {
			validatePlatformForSymlink(true, "win32");
		} catch {
			// Expected
		}

		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("Resolution options"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("symlink: false"),
		);
		expect(mockSetFailed).toHaveBeenCalledWith(
			expect.stringContaining("ubuntu-latest"),
		);
	});

	test("throws WindowsSymlinkError with correct name", () => {
		let thrownError: WindowsSymlinkError | undefined;
		try {
			validatePlatformForSymlink(true, "win32");
		} catch (error) {
			if (error instanceof WindowsSymlinkError) {
				thrownError = error;
			}
		}

		expect(thrownError).toBeDefined();
		expect(thrownError?.name).toBe("WindowsSymlinkError");
	});
});

describe("WindowsSymlinkError", () => {
	test("has correct name property", () => {
		const error = new WindowsSymlinkError("test message");
		expect(error.name).toBe("WindowsSymlinkError");
	});

	test("stores error message", () => {
		const error = new WindowsSymlinkError("Custom error message");
		expect(error.message).toBe("Custom error message");
	});

	test("is an instance of Error", () => {
		const error = new WindowsSymlinkError("test");
		expect(error instanceof Error).toBe(true);
		expect(error instanceof WindowsSymlinkError).toBe(true);
	});
});
