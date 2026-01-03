import { describe, expect, test } from "bun:test";
import {
	createEmptyOutput,
	extractJSONFromOutput,
	getCreateUpdates,
	getDeleteUpdates,
	getModifyUpdates,
	getUpdatesByAction,
	hasUpdates,
	IntentActionSchema,
	IntentUpdateSchema,
	type LLMOutput,
	LLMOutputSchema,
	parseLLMOutput,
	parseRawLLMOutput,
	safeParseLLMOutput,
} from "../../src/opencode/output-schema";

describe("IntentActionSchema", () => {
	test("accepts 'create'", () => {
		expect(IntentActionSchema.parse("create")).toBe("create");
	});

	test("accepts 'update'", () => {
		expect(IntentActionSchema.parse("update")).toBe("update");
	});

	test("accepts 'delete'", () => {
		expect(IntentActionSchema.parse("delete")).toBe("delete");
	});

	test("rejects invalid action", () => {
		expect(() => IntentActionSchema.parse("invalid")).toThrow();
	});

	test("exports correct options", () => {
		expect(IntentActionSchema.options).toEqual(["create", "update", "delete"]);
	});
});

describe("IntentUpdateSchema", () => {
	describe("create action", () => {
		test("accepts valid create update", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "create",
				reason: "New API package needs documentation",
				suggestedContent: "# API Package\n\nThis package contains...",
			};
			const result = IntentUpdateSchema.parse(update);
			expect(result.nodePath).toBe("packages/api/AGENTS.md");
			expect(result.action).toBe("create");
			expect(result.reason).toBe("New API package needs documentation");
			expect(result.suggestedContent).toBe(
				"# API Package\n\nThis package contains...",
			);
		});

		test("accepts create with otherNodePath", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				otherNodePath: "packages/api/CLAUDE.md",
				action: "create",
				reason: "New API package",
				suggestedContent: "# API Package",
			};
			const result = IntentUpdateSchema.parse(update);
			expect(result.otherNodePath).toBe("packages/api/CLAUDE.md");
		});

		test("rejects create without suggestedContent", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "create",
				reason: "New API package",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"suggestedContent is required for create action",
			);
		});

		test("rejects create with currentContent", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "create",
				reason: "New API package",
				suggestedContent: "# New content",
				currentContent: "# Old content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"currentContent should not be provided for create action",
			);
		});
	});

	describe("update action", () => {
		test("accepts valid update", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "update",
				reason: "API endpoints changed",
				currentContent: "# API Package\n\nOld content...",
				suggestedContent: "# API Package\n\nNew content...",
			};
			const result = IntentUpdateSchema.parse(update);
			expect(result.action).toBe("update");
			expect(result.currentContent).toBe("# API Package\n\nOld content...");
			expect(result.suggestedContent).toBe("# API Package\n\nNew content...");
		});

		test("rejects update without currentContent", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "update",
				reason: "API endpoints changed",
				suggestedContent: "# New content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"currentContent is required for update action",
			);
		});

		test("rejects update without suggestedContent", () => {
			const update = {
				nodePath: "packages/api/AGENTS.md",
				action: "update",
				reason: "API endpoints changed",
				currentContent: "# Old content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"suggestedContent is required for update action",
			);
		});
	});

	describe("delete action", () => {
		test("accepts valid delete", () => {
			const update = {
				nodePath: "packages/deprecated/AGENTS.md",
				action: "delete",
				reason: "Package has been removed",
				currentContent: "# Deprecated Package\n\nOld content...",
			};
			const result = IntentUpdateSchema.parse(update);
			expect(result.action).toBe("delete");
			expect(result.currentContent).toBe(
				"# Deprecated Package\n\nOld content...",
			);
			expect(result.suggestedContent).toBeUndefined();
		});

		test("rejects delete without currentContent", () => {
			const update = {
				nodePath: "packages/deprecated/AGENTS.md",
				action: "delete",
				reason: "Package has been removed",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"currentContent is required for delete action",
			);
		});

		test("rejects delete with suggestedContent", () => {
			const update = {
				nodePath: "packages/deprecated/AGENTS.md",
				action: "delete",
				reason: "Package has been removed",
				currentContent: "# Old content",
				suggestedContent: "# This should not exist",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow(
				"suggestedContent should not be provided for delete action",
			);
		});
	});

	describe("required fields", () => {
		test("rejects empty nodePath", () => {
			const update = {
				nodePath: "",
				action: "create",
				reason: "Test",
				suggestedContent: "Content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow();
		});

		test("rejects empty reason", () => {
			const update = {
				nodePath: "AGENTS.md",
				action: "create",
				reason: "",
				suggestedContent: "Content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow();
		});

		test("rejects missing nodePath", () => {
			const update = {
				action: "create",
				reason: "Test",
				suggestedContent: "Content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow();
		});

		test("rejects missing action", () => {
			const update = {
				nodePath: "AGENTS.md",
				reason: "Test",
				suggestedContent: "Content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow();
		});

		test("rejects missing reason", () => {
			const update = {
				nodePath: "AGENTS.md",
				action: "create",
				suggestedContent: "Content",
			};
			expect(() => IntentUpdateSchema.parse(update)).toThrow();
		});
	});
});

describe("LLMOutputSchema", () => {
	test("accepts valid output with updates", () => {
		const output = {
			updates: [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Initialize intent layer",
					suggestedContent: "# Root AGENTS.md",
				},
			],
		};
		const result = LLMOutputSchema.parse(output);
		expect(result.updates).toHaveLength(1);
		expect(result.updates[0]?.nodePath).toBe("AGENTS.md");
	});

	test("accepts empty updates array", () => {
		const output = { updates: [] };
		const result = LLMOutputSchema.parse(output);
		expect(result.updates).toHaveLength(0);
	});

	test("accepts multiple updates", () => {
		const output = {
			updates: [
				{
					nodePath: "AGENTS.md",
					action: "update",
					reason: "Update root",
					currentContent: "# Old",
					suggestedContent: "# New",
				},
				{
					nodePath: "packages/api/AGENTS.md",
					action: "create",
					reason: "New API package",
					suggestedContent: "# API",
				},
			],
		};
		const result = LLMOutputSchema.parse(output);
		expect(result.updates).toHaveLength(2);
	});

	test("rejects missing updates field", () => {
		const output = {};
		expect(() => LLMOutputSchema.parse(output)).toThrow();
	});

	test("rejects updates as non-array", () => {
		const output = { updates: "not an array" };
		expect(() => LLMOutputSchema.parse(output)).toThrow();
	});
});

describe("parseLLMOutput", () => {
	test("parses valid JSON string", () => {
		const json = JSON.stringify({
			updates: [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Init",
					suggestedContent: "# Content",
				},
			],
		});
		const result = parseLLMOutput(json);
		expect(result.updates).toHaveLength(1);
	});

	test("throws on invalid JSON", () => {
		expect(() => parseLLMOutput("not json")).toThrow();
	});

	test("throws on valid JSON but invalid schema", () => {
		const json = JSON.stringify({ updates: "not an array" });
		expect(() => parseLLMOutput(json)).toThrow();
	});
});

describe("safeParseLLMOutput", () => {
	test("returns success for valid input", () => {
		const json = JSON.stringify({
			updates: [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Init",
					suggestedContent: "# Content",
				},
			],
		});
		const result = safeParseLLMOutput(json);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.updates).toHaveLength(1);
		}
	});

	test("returns error for invalid JSON", () => {
		const result = safeParseLLMOutput("not json {");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("Invalid JSON");
		}
	});

	test("returns error for schema validation failure", () => {
		const json = JSON.stringify({
			updates: [
				{
					nodePath: "AGENTS.md",
					action: "create",
					reason: "Init",
					// missing suggestedContent
				},
			],
		});
		const result = safeParseLLMOutput(json);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("Schema validation failed");
			expect(result.error).toContain("suggestedContent");
		}
	});
});

describe("extractJSONFromOutput", () => {
	test("returns trimmed JSON when input is pure JSON", () => {
		const json = '  {"updates": []}  ';
		const result = extractJSONFromOutput(json);
		expect(result).toBe('{"updates": []}');
	});

	test("extracts JSON from text with prefix", () => {
		const input =
			"Here is my analysis:\n\n" + '{"updates": [{"nodePath": "AGENTS.md"}]}';
		const result = extractJSONFromOutput(input);
		expect(result).toBe('{"updates": [{"nodePath": "AGENTS.md"}]}');
	});

	test("extracts JSON from text with suffix", () => {
		const input =
			'{"updates": [{"nodePath": "AGENTS.md"}]}\n\nLet me know if you need more.';
		const result = extractJSONFromOutput(input);
		expect(result).toBe('{"updates": [{"nodePath": "AGENTS.md"}]}');
	});

	test("extracts JSON from text with both prefix and suffix", () => {
		const input =
			"Analysis:\n" +
			'{"updates": [{"nodePath": "AGENTS.md"}]}\n' +
			"End of response.";
		const result = extractJSONFromOutput(input);
		expect(result).toBe('{"updates": [{"nodePath": "AGENTS.md"}]}');
	});

	test("handles multiline JSON", () => {
		const input = `Here is the output:
{
  "updates": [
    {
      "nodePath": "AGENTS.md"
    }
  ]
}
Done.`;
		const result = extractJSONFromOutput(input);
		expect(result).toContain('"updates"');
		expect(result).toContain('"nodePath"');
	});

	test("returns original when no JSON found", () => {
		const input = "No JSON here, just plain text.";
		const result = extractJSONFromOutput(input);
		expect(result).toBe(input);
	});
});

describe("parseRawLLMOutput", () => {
	test("parses clean JSON", () => {
		const json = '{"updates": []}';
		const result = parseRawLLMOutput(json);
		expect(result.success).toBe(true);
	});

	test("parses JSON with surrounding text", () => {
		const raw =
			"Here is my response:\n" +
			'{"updates": [{"nodePath": "AGENTS.md", "action": "create", "reason": "Init", "suggestedContent": "# Content"}]}' +
			"\nDone.";
		const result = parseRawLLMOutput(raw);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.updates).toHaveLength(1);
		}
	});

	test("returns error for completely invalid input", () => {
		const raw = "This has no JSON at all.";
		const result = parseRawLLMOutput(raw);
		expect(result.success).toBe(false);
	});
});

describe("helper functions", () => {
	const sampleOutput: LLMOutput = {
		updates: [
			{
				nodePath: "AGENTS.md",
				action: "create",
				reason: "Init root",
				suggestedContent: "# Root",
			},
			{
				nodePath: "packages/api/AGENTS.md",
				action: "create",
				reason: "New API",
				suggestedContent: "# API",
			},
			{
				nodePath: "packages/web/AGENTS.md",
				action: "update",
				reason: "Update web docs",
				currentContent: "# Old",
				suggestedContent: "# New",
			},
			{
				nodePath: "packages/deprecated/AGENTS.md",
				action: "delete",
				reason: "Remove deprecated",
				currentContent: "# Deprecated",
			},
		],
	};

	describe("hasUpdates", () => {
		test("returns true when updates exist", () => {
			expect(hasUpdates(sampleOutput)).toBe(true);
		});

		test("returns false for empty updates", () => {
			expect(hasUpdates({ updates: [] })).toBe(false);
		});
	});

	describe("getUpdatesByAction", () => {
		test("filters by create action", () => {
			const creates = getUpdatesByAction(sampleOutput, "create");
			expect(creates).toHaveLength(2);
			expect(creates.every((u) => u.action === "create")).toBe(true);
		});

		test("filters by update action", () => {
			const updates = getUpdatesByAction(sampleOutput, "update");
			expect(updates).toHaveLength(1);
			expect(updates[0]?.nodePath).toBe("packages/web/AGENTS.md");
		});

		test("filters by delete action", () => {
			const deletes = getUpdatesByAction(sampleOutput, "delete");
			expect(deletes).toHaveLength(1);
			expect(deletes[0]?.nodePath).toBe("packages/deprecated/AGENTS.md");
		});
	});

	describe("getCreateUpdates", () => {
		test("returns create updates", () => {
			const creates = getCreateUpdates(sampleOutput);
			expect(creates).toHaveLength(2);
		});
	});

	describe("getModifyUpdates", () => {
		test("returns update (modify) updates", () => {
			const modifies = getModifyUpdates(sampleOutput);
			expect(modifies).toHaveLength(1);
		});
	});

	describe("getDeleteUpdates", () => {
		test("returns delete updates", () => {
			const deletes = getDeleteUpdates(sampleOutput);
			expect(deletes).toHaveLength(1);
		});
	});

	describe("createEmptyOutput", () => {
		test("creates empty output", () => {
			const empty = createEmptyOutput();
			expect(empty.updates).toEqual([]);
			expect(hasUpdates(empty)).toBe(false);
		});
	});
});
