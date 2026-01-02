import { describe, expect, test } from "bun:test";
import {
	type ActionInputs,
	ActionInputsSchema,
	FilesSchema,
	ModeSchema,
	OutputSchema,
	parseActionInputs,
	SymlinkSourceSchema,
} from "../../src/config/schema";

describe("ActionInputsSchema", () => {
	describe("defaults", () => {
		test("applies all defaults when empty object provided", () => {
			const result = ActionInputsSchema.parse({});

			expect(result.mode).toBe("analyze");
			expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
			expect(result.files).toBe("agents");
			expect(result.symlink).toBe(false);
			expect(result.symlink_source).toBe("agents");
			expect(result.output).toBe("pr_comments");
			expect(result.new_nodes).toBe(true);
			expect(result.split_large_nodes).toBe(true);
			expect(result.token_budget_percent).toBe(5);
			expect(result.skip_binary_files).toBe(true);
			expect(result.file_max_lines).toBe(8000);
			expect(result.prompts).toEqual([]);
		});
	});

	describe("mode", () => {
		test("accepts 'analyze'", () => {
			const result = ActionInputsSchema.parse({ mode: "analyze" });
			expect(result.mode).toBe("analyze");
		});

		test("accepts 'checkbox-handler'", () => {
			const result = ActionInputsSchema.parse({ mode: "checkbox-handler" });
			expect(result.mode).toBe("checkbox-handler");
		});

		test("rejects invalid mode", () => {
			expect(() => ActionInputsSchema.parse({ mode: "invalid" })).toThrow();
		});
	});

	describe("files", () => {
		test("accepts 'agents'", () => {
			const result = ActionInputsSchema.parse({ files: "agents" });
			expect(result.files).toBe("agents");
		});

		test("accepts 'claude'", () => {
			const result = ActionInputsSchema.parse({ files: "claude" });
			expect(result.files).toBe("claude");
		});

		test("accepts 'both'", () => {
			const result = ActionInputsSchema.parse({ files: "both" });
			expect(result.files).toBe("both");
		});

		test("rejects invalid files value", () => {
			expect(() => ActionInputsSchema.parse({ files: "invalid" })).toThrow();
		});
	});

	describe("output", () => {
		test("accepts 'pr_comments'", () => {
			const result = ActionInputsSchema.parse({ output: "pr_comments" });
			expect(result.output).toBe("pr_comments");
		});

		test("accepts 'pr_commit'", () => {
			const result = ActionInputsSchema.parse({ output: "pr_commit" });
			expect(result.output).toBe("pr_commit");
		});

		test("accepts 'new_pr'", () => {
			const result = ActionInputsSchema.parse({ output: "new_pr" });
			expect(result.output).toBe("new_pr");
		});

		test("rejects invalid output value", () => {
			expect(() => ActionInputsSchema.parse({ output: "invalid" })).toThrow();
		});
	});

	describe("boolean coercion", () => {
		test("coerces string 'true' to true", () => {
			const result = ActionInputsSchema.parse({ symlink: "true" });
			expect(result.symlink).toBe(true);
		});

		test("coerces string 'false' to false", () => {
			const result = ActionInputsSchema.parse({ symlink: "false" });
			expect(result.symlink).toBe(false);
		});

		test("coerces string 'TRUE' to true (case insensitive)", () => {
			const result = ActionInputsSchema.parse({ symlink: "TRUE" });
			expect(result.symlink).toBe(true);
		});

		test("accepts actual boolean true", () => {
			const result = ActionInputsSchema.parse({ symlink: true });
			expect(result.symlink).toBe(true);
		});

		test("accepts actual boolean false", () => {
			const result = ActionInputsSchema.parse({ symlink: false });
			expect(result.symlink).toBe(false);
		});

		test("coerces all boolean fields correctly", () => {
			const result = ActionInputsSchema.parse({
				symlink: "true",
				new_nodes: "false",
				split_large_nodes: "true",
				skip_binary_files: "false",
			});
			expect(result.symlink).toBe(true);
			expect(result.new_nodes).toBe(false);
			expect(result.split_large_nodes).toBe(true);
			expect(result.skip_binary_files).toBe(false);
		});
	});

	describe("number coercion", () => {
		test("coerces string number to number", () => {
			const result = ActionInputsSchema.parse({ token_budget_percent: "10" });
			expect(result.token_budget_percent).toBe(10);
		});

		test("accepts actual number", () => {
			const result = ActionInputsSchema.parse({ token_budget_percent: 15 });
			expect(result.token_budget_percent).toBe(15);
		});

		test("coerces file_max_lines correctly", () => {
			const result = ActionInputsSchema.parse({ file_max_lines: "10000" });
			expect(result.file_max_lines).toBe(10000);
		});

		test("throws on invalid number string", () => {
			expect(() =>
				ActionInputsSchema.parse({ token_budget_percent: "not-a-number" }),
			).toThrow();
		});
	});

	describe("symlink_source", () => {
		test("accepts 'agents'", () => {
			const result = ActionInputsSchema.parse({ symlink_source: "agents" });
			expect(result.symlink_source).toBe("agents");
		});

		test("accepts 'claude'", () => {
			const result = ActionInputsSchema.parse({ symlink_source: "claude" });
			expect(result.symlink_source).toBe("claude");
		});

		test("rejects invalid symlink_source value", () => {
			expect(() =>
				ActionInputsSchema.parse({ symlink_source: "invalid" }),
			).toThrow();
		});
	});

	describe("prompts", () => {
		test("accepts empty string", () => {
			const result = ActionInputsSchema.parse({ prompts: "" });
			expect(result.prompts).toEqual([]);
		});

		test("accepts whitespace-only string", () => {
			const result = ActionInputsSchema.parse({ prompts: "   " });
			expect(result.prompts).toEqual([]);
		});

		test("passes through non-empty string for later YAML parsing", () => {
			const yamlString = "- pattern: '**/*'\n  prompt: 'Test prompt'";
			const result = ActionInputsSchema.parse({ prompts: yamlString });
			expect(result.prompts).toBe(yamlString);
		});

		test("accepts array of prompt configs", () => {
			const prompts = [
				{ pattern: "**/*", prompt: "General prompt" },
				{
					pattern: "packages/api/**",
					agents_prompt: "API prompt",
					claude_prompt: "Claude API prompt",
				},
			];
			const result = ActionInputsSchema.parse({ prompts });
			expect(result.prompts).toEqual(prompts);
		});
	});

	describe("model", () => {
		test("accepts custom model string", () => {
			const result = ActionInputsSchema.parse({
				model: "openrouter/anthropic/claude-3-opus",
			});
			expect(result.model).toBe("openrouter/anthropic/claude-3-opus");
		});
	});
});

describe("parseActionInputs", () => {
	test("filters out undefined values", () => {
		const result = parseActionInputs({
			mode: "analyze",
			model: undefined,
			files: "both",
		});

		expect(result.mode).toBe("analyze");
		expect(result.model).toBe("anthropic/claude-sonnet-4-20250514"); // default
		expect(result.files).toBe("both");
	});

	test("filters out empty string values", () => {
		const result = parseActionInputs({
			mode: "checkbox-handler",
			model: "",
			output: "new_pr",
		});

		expect(result.mode).toBe("checkbox-handler");
		expect(result.model).toBe("anthropic/claude-sonnet-4-20250514"); // default
		expect(result.output).toBe("new_pr");
	});

	test("parses complete valid input", () => {
		const result = parseActionInputs({
			mode: "analyze",
			model: "anthropic/claude-3-opus",
			files: "both",
			symlink: "true",
			symlink_source: "claude",
			output: "pr_commit",
			new_nodes: "false",
			split_large_nodes: "true",
			token_budget_percent: "10",
			skip_binary_files: "false",
			file_max_lines: "5000",
			prompts: "",
		});

		expect(result).toEqual({
			mode: "analyze",
			model: "anthropic/claude-3-opus",
			files: "both",
			symlink: true,
			symlink_source: "claude",
			output: "pr_commit",
			new_nodes: false,
			split_large_nodes: true,
			token_budget_percent: 10,
			skip_binary_files: false,
			file_max_lines: 5000,
			prompts: [],
		});
	});
});

describe("individual enum schemas", () => {
	test("ModeSchema exports correct values", () => {
		expect(ModeSchema.options).toEqual(["analyze", "checkbox-handler"]);
	});

	test("FilesSchema exports correct values", () => {
		expect(FilesSchema.options).toEqual(["agents", "claude", "both"]);
	});

	test("OutputSchema exports correct values", () => {
		expect(OutputSchema.options).toEqual([
			"pr_comments",
			"pr_commit",
			"new_pr",
		]);
	});

	test("SymlinkSourceSchema exports correct values", () => {
		expect(SymlinkSourceSchema.options).toEqual(["agents", "claude"]);
	});
});
