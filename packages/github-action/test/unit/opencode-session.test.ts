/**
 * Unit tests for OpenCode session management
 */

import { describe, expect, test } from "bun:test";
import {
	buildSessionTitle,
	IntentAnalysisSession,
	parseModelString,
	SessionError,
} from "../../src/opencode/session";

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
		const createMockClient = (overrides: Record<string, unknown> = {}) => ({
			session: {
				prompt: async () => ({
					data: {
						parts: [{ type: "text", text: '{"updates":[]}' }],
					},
				}),
				abort: async () => true,
				delete: async () => true,
				messages: async () => [],
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
				prompt: async () => ({
					data: {
						parts: [
							{
								type: "text",
								text: '{"updates":[{"nodePath":"AGENTS.md","action":"create","reason":"test","suggestedContent":"# Test"}]}',
							},
						],
					},
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
				prompt: async () => ({
					data: {
						parts: [{ type: "text", text: "not valid json" }],
					},
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
				prompt: async () => ({
					data: {
						parts: [{ type: "text", text: '{"updates":[]}' }],
					},
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
				prompt: async () => ({
					data: {
						parts: [{ type: "text", text: "invalid" }],
					},
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

		test("handles response with direct parts array", async () => {
			const mockClient = createMockClient({
				prompt: async () => ({
					parts: [{ type: "text", text: '{"updates":[]}' }],
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

		test("handles response with info.text", async () => {
			const mockClient = createMockClient({
				prompt: async () => ({
					data: { info: { text: '{"updates":[]}' } },
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

		test("handles string response", async () => {
			const mockClient = createMockClient({
				prompt: async () => '{"updates":[]}',
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
				prompt: async (args: {
					body: { model?: { providerID: string; modelID: string } };
				}) => {
					capturedModel = args.body.model;
					return {
						data: { parts: [{ type: "text", text: '{"updates":[]}' }] },
					};
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
				prompt: async (args: {
					body: { model?: { providerID: string; modelID: string } };
				}) => {
					capturedModel = args.body.model;
					return {
						data: { parts: [{ type: "text", text: '{"updates":[]}' }] },
					};
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
				prompt: async () => {
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
	});
});
