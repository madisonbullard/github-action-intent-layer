/**
 * Unit tests for OpenCode session management
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	buildSessionTitle,
	checkAndHandleModelAccessError,
	detectModelAccessError,
	formatModelAccessErrorMessage,
	handleModelAccessError,
	IntentAnalysisSession,
	ModelAccessError,
	parseModelString,
	SessionError,
} from "../../src/opencode/session";

// Mock @actions/core
// biome-ignore lint/suspicious/noExplicitAny: Mock function needs to accept any arguments
const mockSetFailed = mock((_msg: any) => {});
// biome-ignore lint/suspicious/noExplicitAny: Mock function needs to accept any arguments
const mockError = mock((_msg: any) => {});

mock.module("@actions/core", () => ({
	setFailed: mockSetFailed,
	error: mockError,
}));

describe("OpenCode Session", () => {
	describe("parseModelString", () => {
		test("parses standard anthropic model string", () => {
			const result = parseModelString("anthropic/claude-sonnet-4-20250514");
			expect(result.providerID).toBe("anthropic");
			expect(result.modelID).toBe("claude-sonnet-4-20250514");
		});

		test("parses openrouter model string", () => {
			const result = parseModelString(
				"openrouter/anthropic/claude-sonnet-4-20250514",
			);
			expect(result.providerID).toBe("openrouter");
			expect(result.modelID).toBe("anthropic/claude-sonnet-4-20250514");
		});

		test("parses openai model string", () => {
			const result = parseModelString("openai/gpt-4");
			expect(result.providerID).toBe("openai");
			expect(result.modelID).toBe("gpt-4");
		});

		test("parses model string with multiple slashes", () => {
			const result = parseModelString("provider/model/variant/v2");
			expect(result.providerID).toBe("provider");
			expect(result.modelID).toBe("model/variant/v2");
		});

		test("parses openrouter with deeply nested model path", () => {
			const result = parseModelString("openrouter/google/gemini-1.5/pro");
			expect(result.providerID).toBe("openrouter");
			expect(result.modelID).toBe("google/gemini-1.5/pro");
		});

		test("throws on empty string", () => {
			expect(() => parseModelString("")).toThrow(SessionError);
		});

		test("throws on model without slash", () => {
			expect(() => parseModelString("model-only")).toThrow(SessionError);
		});

		test("throws on model starting with slash", () => {
			expect(() => parseModelString("/model")).toThrow(SessionError);
		});

		test("throws on openrouter without model path", () => {
			expect(() => parseModelString("openrouter/provider")).toThrow(
				SessionError,
			);
		});

		test("error message mentions expected format", () => {
			expect(() => parseModelString("invalid")).toThrow(/provider\/model/);
		});
	});

	describe("buildSessionTitle", () => {
		test("builds title with PR number only", () => {
			const title = buildSessionTitle(123);
			expect(title).toBe("Intent Layer Analysis for PR #123");
		});

		test("builds title with PR number and repo name", () => {
			const title = buildSessionTitle(456, "owner/repo");
			expect(title).toBe("Intent Layer Analysis for PR #456 (owner/repo)");
		});

		test("handles single digit PR numbers", () => {
			const title = buildSessionTitle(1);
			expect(title).toBe("Intent Layer Analysis for PR #1");
		});

		test("handles large PR numbers", () => {
			const title = buildSessionTitle(99999);
			expect(title).toBe("Intent Layer Analysis for PR #99999");
		});
	});

	describe("SessionError", () => {
		test("creates error with message", () => {
			const error = new SessionError("test message");
			expect(error.message).toBe("test message");
			expect(error.name).toBe("SessionError");
			expect(error.originalCause).toBeUndefined();
		});

		test("creates error with message and cause", () => {
			const cause = new Error("underlying error");
			const error = new SessionError("test message", cause);
			expect(error.message).toBe("test message");
			expect(error.name).toBe("SessionError");
			expect(error.originalCause).toBe(cause);
		});

		test("is instanceof Error", () => {
			const error = new SessionError("test");
			expect(error instanceof Error).toBe(true);
			expect(error instanceof SessionError).toBe(true);
		});

		test("can store non-Error cause", () => {
			const cause = { code: "NETWORK_ERROR", status: 500 };
			const error = new SessionError("network failed", cause);
			expect(error.originalCause).toEqual(cause);
		});
	});

	describe("IntentAnalysisSession", () => {
		// Mock client for testing
		// The new implementation uses promptAsync + messages polling
		const createMockClient = (overrides: Record<string, unknown> = {}) => ({
			session: {
				prompt: async () => ({}), // Used for injectContext with noReply
				promptAsync: async () => ({}), // Used to send the prompt
				abort: async () => true,
				delete: async () => true,
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [{ type: "text", text: '{"updates":[]}' }],
						},
					],
				}),
				...overrides,
			},
		});

		test("exposes session id", () => {
			const mockClient = createMockClient();
			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-session-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);
			expect(session.id).toBe("test-session-id");
		});

		test("prompt returns parsed output for valid JSON", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [
								{
									type: "text",
									text: '{"updates":[{"nodePath":"AGENTS.md","action":"create","reason":"test","suggestedContent":"# Test"}]}',
								},
							],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const result = await session.prompt({ prompt: "test prompt" });

			expect(result.parsedOutput).toBeDefined();
			expect(result.parsedOutput?.updates).toHaveLength(1);
			expect(result.parsedOutput?.updates[0]?.nodePath).toBe("AGENTS.md");
			expect(result.parseError).toBeUndefined();
		});

		test("prompt returns parse error for invalid JSON", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [{ type: "text", text: "not valid json" }],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const result = await session.prompt({ prompt: "test prompt" });

			expect(result.parsedOutput).toBeUndefined();
			expect(result.parseError).toBeDefined();
			expect(result.rawResponse).toBe("not valid json");
		});

		test("promptForOutput returns output for valid JSON", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [{ type: "text", text: '{"updates":[]}' }],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const output = await session.promptForOutput({ prompt: "test prompt" });

			expect(output.updates).toEqual([]);
		});

		test("promptForOutput throws for invalid JSON", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [{ type: "text", text: "invalid" }],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(
				session.promptForOutput({ prompt: "test prompt" }),
			).rejects.toThrow(SessionError);
		});

		test("injectContext calls prompt with noReply", async () => {
			let capturedBody: unknown;
			const mockClient = createMockClient({
				prompt: async (args: { body: unknown }) => {
					capturedBody = args.body;
					return {};
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await session.injectContext("context text");

			expect(capturedBody).toEqual({
				noReply: true,
				parts: [{ type: "text", text: "context text" }],
			});
		});

		test("abort calls client abort", async () => {
			let abortCalled = false;
			const mockClient = createMockClient({
				abort: async () => {
					abortCalled = true;
					return true;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await session.abort();

			expect(abortCalled).toBe(true);
		});

		test("delete calls client delete", async () => {
			let deleteCalled = false;
			const mockClient = createMockClient({
				delete: async () => {
					deleteCalled = true;
					return true;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await session.delete();

			expect(deleteCalled).toBe(true);
		});

		test("handles response with multiple text parts", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [
								{ type: "text", text: '{"updates":' },
								{ type: "text", text: "[]}'" },
							],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const result = await session.prompt({ prompt: "test" });
			expect(result.parsedOutput?.updates).toEqual([]);
		});

		test("handles messages response without data wrapper", async () => {
			const mockClient = createMockClient({
				messages: async () => [
					{
						info: { role: "assistant", time: { completed: Date.now() } },
						parts: [{ type: "text", text: '{"updates":[]}' }],
					},
				],
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const result = await session.prompt({ prompt: "test" });
			expect(result.parsedOutput?.updates).toEqual([]);
		});

		test("handles messages response with user and assistant messages", async () => {
			const mockClient = createMockClient({
				messages: async () => ({
					data: [
						{
							info: { role: "user", time: { completed: Date.now() } },
							parts: [{ type: "text", text: "test prompt" }],
						},
						{
							info: { role: "assistant", time: { completed: Date.now() } },
							parts: [{ type: "text", text: '{"updates":[]}' }],
						},
					],
				}),
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			const result = await session.prompt({ prompt: "test" });
			expect(result.parsedOutput?.updates).toEqual([]);
		});

		test("uses custom model when provided in prompt config", async () => {
			let capturedModel: unknown;
			const mockClient = createMockClient({
				promptAsync: async (args: {
					body: { model?: { providerID: string; modelID: string } };
				}) => {
					capturedModel = args.body.model;
					return {};
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "default-model" },
			);

			await session.prompt({
				prompt: "test",
				model: { providerID: "openai", modelID: "gpt-4" },
			});

			expect(capturedModel).toEqual({
				providerID: "openai",
				modelID: "gpt-4",
			});
		});

		test("uses default model when not provided in prompt config", async () => {
			let capturedModel: unknown;
			const mockClient = createMockClient({
				promptAsync: async (args: {
					body: { model?: { providerID: string; modelID: string } };
				}) => {
					capturedModel = args.body.model;
					return {};
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "default-model" },
			);

			await session.prompt({ prompt: "test" });

			expect(capturedModel).toEqual({
				providerID: "anthropic",
				modelID: "default-model",
			});
		});

		test("prompt wraps client errors in SessionError", async () => {
			const mockClient = createMockClient({
				promptAsync: async () => {
					throw new Error("network error");
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(session.prompt({ prompt: "test" })).rejects.toThrow(
				SessionError,
			);
		});

		test("prompt throws ModelAccessError for 401 status code", async () => {
			const mockClient = createMockClient({
				promptAsync: async () => {
					const error = new Error("Unauthorized") as Error & { status: number };
					error.status = 401;
					throw error;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(session.prompt({ prompt: "test" })).rejects.toThrow(
				ModelAccessError,
			);
		});

		test("prompt throws ModelAccessError for authentication_error code", async () => {
			const mockClient = createMockClient({
				promptAsync: async () => {
					const error = new Error("Invalid API key") as Error & {
						code: string;
					};
					error.code = "authentication_error";
					throw error;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(session.prompt({ prompt: "test" })).rejects.toThrow(
				ModelAccessError,
			);
		});

		test("prompt throws ModelAccessError for 429 rate limit", async () => {
			const mockClient = createMockClient({
				promptAsync: async () => {
					const error = new Error("Rate limited") as Error & { status: number };
					error.status = 429;
					throw error;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(session.prompt({ prompt: "test" })).rejects.toThrow(
				ModelAccessError,
			);
		});

		test("prompt throws ModelAccessError for 404 model not found", async () => {
			const mockClient = createMockClient({
				promptAsync: async () => {
					const error = new Error("Model not found") as Error & {
						status: number;
					};
					error.status = 404;
					throw error;
				},
			});

			const session = new IntentAnalysisSession(
				mockClient as never,
				"test-id",
				{ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
			);

			await expect(session.prompt({ prompt: "test" })).rejects.toThrow(
				ModelAccessError,
			);
		});
	});

	describe("ModelAccessError", () => {
		test("creates error with message", () => {
			const error = new ModelAccessError("test message");
			expect(error.message).toBe("test message");
			expect(error.name).toBe("ModelAccessError");
			expect(error.originalCause).toBeUndefined();
			expect(error.statusCode).toBeUndefined();
			expect(error.errorCode).toBeUndefined();
		});

		test("creates error with all options", () => {
			const cause = new Error("underlying error");
			const error = new ModelAccessError("test message", {
				cause,
				statusCode: 401,
				errorCode: "authentication_error",
			});
			expect(error.message).toBe("test message");
			expect(error.originalCause).toBe(cause);
			expect(error.statusCode).toBe(401);
			expect(error.errorCode).toBe("authentication_error");
		});

		test("isAuthenticationError returns true for 401", () => {
			const error = new ModelAccessError("test", { statusCode: 401 });
			expect(error.isAuthenticationError()).toBe(true);
			expect(error.isRateLimitError()).toBe(false);
			expect(error.isModelUnavailableError()).toBe(false);
		});

		test("isAuthenticationError returns true for authentication_error code", () => {
			const error = new ModelAccessError("test", {
				errorCode: "authentication_error",
			});
			expect(error.isAuthenticationError()).toBe(true);
		});

		test("isAuthenticationError returns true for invalid_api_key code", () => {
			const error = new ModelAccessError("test", {
				errorCode: "invalid_api_key",
			});
			expect(error.isAuthenticationError()).toBe(true);
		});

		test("isRateLimitError returns true for 429", () => {
			const error = new ModelAccessError("test", { statusCode: 429 });
			expect(error.isRateLimitError()).toBe(true);
			expect(error.isAuthenticationError()).toBe(false);
		});

		test("isRateLimitError returns true for rate_limit_error code", () => {
			const error = new ModelAccessError("test", {
				errorCode: "rate_limit_error",
			});
			expect(error.isRateLimitError()).toBe(true);
		});

		test("isModelUnavailableError returns true for 404", () => {
			const error = new ModelAccessError("test", { statusCode: 404 });
			expect(error.isModelUnavailableError()).toBe(true);
			expect(error.isAuthenticationError()).toBe(false);
		});

		test("isModelUnavailableError returns true for model_not_found code", () => {
			const error = new ModelAccessError("test", {
				errorCode: "model_not_found",
			});
			expect(error.isModelUnavailableError()).toBe(true);
		});

		test("is instanceof Error", () => {
			const error = new ModelAccessError("test");
			expect(error instanceof Error).toBe(true);
			expect(error instanceof ModelAccessError).toBe(true);
		});
	});

	describe("detectModelAccessError", () => {
		test("returns false for null/undefined", () => {
			expect(detectModelAccessError(null).isModelAccessError).toBe(false);
			expect(detectModelAccessError(undefined).isModelAccessError).toBe(false);
		});

		test("detects 401 status code from Error", () => {
			const error = new Error("Unauthorized") as Error & { status: number };
			error.status = 401;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(401);
			expect(result.message).toBe("Unauthorized");
		});

		test("detects 429 status code from Error", () => {
			const error = new Error("Rate limited") as Error & { status: number };
			error.status = 429;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(429);
		});

		test("detects 404 status code from Error", () => {
			const error = new Error("Not found") as Error & { status: number };
			error.status = 404;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(404);
		});

		test("detects 403 status code from Error", () => {
			const error = new Error("Forbidden") as Error & { status: number };
			error.status = 403;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(403);
		});

		test("detects 402 quota exceeded status code", () => {
			const error = new Error("Payment required") as Error & { status: number };
			error.status = 402;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(402);
		});

		test("detects statusCode property from Error", () => {
			const error = new Error("Error") as Error & { statusCode: number };
			error.statusCode = 401;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(401);
		});

		test("detects code property from Error", () => {
			const error = new Error("Invalid key") as Error & { code: string };
			error.code = "authentication_error";
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.errorCode).toBe("authentication_error");
		});

		test("detects error_code property from Error", () => {
			const error = new Error("Error") as Error & { error_code: string };
			error.error_code = "rate_limit_error";
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.errorCode).toBe("rate_limit_error");
		});

		test("detects error.type property from Error", () => {
			const error = new Error("Error") as Error & {
				error: { type: string };
			};
			error.error = { type: "model_not_found" };
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.errorCode).toBe("model_not_found");
		});

		test("detects status in response object from Error", () => {
			const error = new Error("Error") as Error & {
				response: { status: number };
			};
			error.response = { status: 401 };
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(401);
		});

		test("detects plain object with status", () => {
			const error = { status: 429, message: "Rate limited" };
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.statusCode).toBe(429);
			expect(result.message).toBe("Rate limited");
		});

		test("detects plain object with error code", () => {
			const error = { code: "permission_denied", message: "Access denied" };
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(true);
			expect(result.errorCode).toBe("permission_denied");
		});

		test("returns false for non-model-access errors", () => {
			const error = new Error("Network timeout") as Error & { status: number };
			error.status = 500;
			const result = detectModelAccessError(error);
			expect(result.isModelAccessError).toBe(false);
		});

		test("handles string error", () => {
			const result = detectModelAccessError("string error");
			expect(result.isModelAccessError).toBe(false);
			expect(result.message).toBe("string error");
		});

		test("recognizes all known error codes", () => {
			const errorCodes = [
				"authentication_error",
				"invalid_api_key",
				"unauthorized",
				"rate_limit_error",
				"rate_limit_exceeded",
				"model_not_found",
				"invalid_model",
				"model_unavailable",
				"permission_denied",
				"access_denied",
				"quota_exceeded",
				"insufficient_quota",
			];

			for (const code of errorCodes) {
				const error = new Error("test") as Error & { code: string };
				error.code = code;
				const result = detectModelAccessError(error);
				expect(result.isModelAccessError).toBe(true);
			}
		});
	});

	describe("formatModelAccessErrorMessage", () => {
		test("formats 401 authentication error", () => {
			const msg = formatModelAccessErrorMessage(
				401,
				undefined,
				"Invalid API key",
			);
			expect(msg).toContain("Invalid API key");
			expect(msg).toContain("ANTHROPIC_API_KEY");
			expect(msg).toContain("OPENROUTER_API_KEY");
		});

		test("formats authentication_error code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"authentication_error",
				"Auth failed",
			);
			expect(msg).toContain("Invalid API key");
		});

		test("formats invalid_api_key code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"invalid_api_key",
				"Key invalid",
			);
			expect(msg).toContain("Invalid API key");
		});

		test("formats 403 permission error", () => {
			const msg = formatModelAccessErrorMessage(403, undefined, "Forbidden");
			expect(msg).toContain("Permission denied");
		});

		test("formats permission_denied code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"permission_denied",
				"No access",
			);
			expect(msg).toContain("Permission denied");
		});

		test("formats 404 model not found error", () => {
			const msg = formatModelAccessErrorMessage(
				404,
				undefined,
				"Model not found",
			);
			expect(msg).toContain("Model not found");
			expect(msg).toContain("model name");
		});

		test("formats model_not_found code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"model_not_found",
				"Unknown model",
			);
			expect(msg).toContain("Model not found");
		});

		test("formats 429 rate limit error", () => {
			const msg = formatModelAccessErrorMessage(
				429,
				undefined,
				"Too many requests",
			);
			expect(msg).toContain("Rate limit exceeded");
			expect(msg).toContain("wait");
		});

		test("formats rate_limit_error code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"rate_limit_error",
				"Rate limited",
			);
			expect(msg).toContain("Rate limit exceeded");
		});

		test("formats 402 quota exceeded error", () => {
			const msg = formatModelAccessErrorMessage(
				402,
				undefined,
				"Payment required",
			);
			expect(msg).toContain("quota exceeded");
			expect(msg).toContain("billing");
		});

		test("formats quota_exceeded code", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				"quota_exceeded",
				"Out of quota",
			);
			expect(msg).toContain("quota exceeded");
		});

		test("formats generic error with original message", () => {
			const msg = formatModelAccessErrorMessage(
				undefined,
				undefined,
				"Something went wrong",
			);
			expect(msg).toContain("Model access failed");
			expect(msg).toContain("Something went wrong");
		});

		test("formats generic error without message", () => {
			const msg = formatModelAccessErrorMessage(undefined, undefined);
			expect(msg).toContain("Model access failed");
			expect(msg).toContain("Unknown error");
		});
	});

	describe("handleModelAccessError", () => {
		beforeEach(() => {
			mockSetFailed.mockClear();
			mockError.mockClear();
		});

		test("calls core.error with detailed message", () => {
			const error = new ModelAccessError("Invalid API key", {
				statusCode: 401,
				errorCode: "authentication_error",
			});

			expect(() => handleModelAccessError(error)).toThrow(ModelAccessError);
			expect(mockError).toHaveBeenCalled();
			const errorMessage = mockError.mock.calls[0]?.[0] as string;
			expect(errorMessage).toContain("Intent Layer Action Failed");
			expect(errorMessage).toContain("Invalid API key");
		});

		test("calls core.setFailed with detailed message", () => {
			const error = new ModelAccessError("Rate limited", { statusCode: 429 });

			expect(() => handleModelAccessError(error)).toThrow(ModelAccessError);
			expect(mockSetFailed).toHaveBeenCalled();
			const failedMessage = mockSetFailed.mock.calls[0]?.[0] as string;
			expect(failedMessage).toContain("Intent Layer Action Failed");
			expect(failedMessage).toContain("Rate limited");
		});

		test("re-throws the original error", () => {
			const error = new ModelAccessError("Test error");

			let caughtError: unknown;
			try {
				handleModelAccessError(error);
			} catch (e) {
				caughtError = e;
			}

			expect(caughtError).toBe(error);
		});

		test("includes authentication troubleshooting for 401 errors", () => {
			const error = new ModelAccessError("Invalid API key", {
				statusCode: 401,
			});

			expect(() => handleModelAccessError(error)).toThrow();
			const errorMessage = mockError.mock.calls[0]?.[0] as string;
			expect(errorMessage).toContain("Troubleshooting steps");
			expect(errorMessage).toContain("ANTHROPIC_API_KEY");
			expect(errorMessage).toContain("OPENROUTER_API_KEY");
		});

		test("includes rate limit troubleshooting for 429 errors", () => {
			const error = new ModelAccessError("Rate limited", { statusCode: 429 });

			expect(() => handleModelAccessError(error)).toThrow();
			const errorMessage = mockError.mock.calls[0]?.[0] as string;
			expect(errorMessage).toContain("Troubleshooting steps");
			expect(errorMessage).toContain("Wait a few minutes");
		});

		test("includes model troubleshooting for 404 errors", () => {
			const error = new ModelAccessError("Model not found", {
				statusCode: 404,
			});

			expect(() => handleModelAccessError(error)).toThrow();
			const errorMessage = mockError.mock.calls[0]?.[0] as string;
			expect(errorMessage).toContain("Troubleshooting steps");
			expect(errorMessage).toContain("model name");
		});

		test("includes error details in message", () => {
			const error = new ModelAccessError("Test error", {
				statusCode: 401,
				errorCode: "invalid_api_key",
			});

			expect(() => handleModelAccessError(error)).toThrow();
			const errorMessage = mockError.mock.calls[0]?.[0] as string;
			expect(errorMessage).toContain("Status code: 401");
			expect(errorMessage).toContain("Error code: invalid_api_key");
		});
	});

	describe("checkAndHandleModelAccessError", () => {
		beforeEach(() => {
			mockSetFailed.mockClear();
			mockError.mockClear();
		});

		test("returns false for non-model-access errors", () => {
			const error = new Error("Network timeout");
			const result = checkAndHandleModelAccessError(error);
			expect(result).toBe(false);
			expect(mockSetFailed).not.toHaveBeenCalled();
		});

		test("throws and fails action for ModelAccessError", () => {
			const error = new ModelAccessError("Invalid key", { statusCode: 401 });

			expect(() => checkAndHandleModelAccessError(error)).toThrow(
				ModelAccessError,
			);
			expect(mockSetFailed).toHaveBeenCalled();
		});

		test("converts and handles errors with model access status codes", () => {
			const error = new Error("Unauthorized") as Error & { status: number };
			error.status = 401;

			expect(() => checkAndHandleModelAccessError(error)).toThrow(
				ModelAccessError,
			);
			expect(mockSetFailed).toHaveBeenCalled();
		});

		test("converts and handles errors with model access error codes", () => {
			const error = new Error("Rate limited") as Error & { code: string };
			error.code = "rate_limit_error";

			expect(() => checkAndHandleModelAccessError(error)).toThrow(
				ModelAccessError,
			);
			expect(mockSetFailed).toHaveBeenCalled();
		});

		test("returns false for server errors (5xx)", () => {
			const error = new Error("Server error") as Error & { status: number };
			error.status = 500;

			const result = checkAndHandleModelAccessError(error);
			expect(result).toBe(false);
			expect(mockSetFailed).not.toHaveBeenCalled();
		});

		test("returns false for null/undefined", () => {
			expect(checkAndHandleModelAccessError(null)).toBe(false);
			expect(checkAndHandleModelAccessError(undefined)).toBe(false);
			expect(mockSetFailed).not.toHaveBeenCalled();
		});

		test("returns false for plain strings", () => {
			const result = checkAndHandleModelAccessError("some error string");
			expect(result).toBe(false);
			expect(mockSetFailed).not.toHaveBeenCalled();
		});
	});
});
