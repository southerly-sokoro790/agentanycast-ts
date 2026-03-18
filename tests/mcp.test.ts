import { describe, it, expect } from "vitest";
import { mcpToolToSkill, skillToMcpTool, mcpToolsToAgentCard, type MCPTool } from "../src/mcp.js";
import type { Skill } from "../src/card.js";

describe("mcpToolToSkill", () => {
  it("converts basic tool", () => {
    const tool: MCPTool = {
      name: "get_weather",
      description: "Get current weather",
      inputSchema: { type: "object", properties: { city: { type: "string" } } },
    };
    const skill = mcpToolToSkill(tool);
    expect(skill.id).toBe("get_weather");
    expect(skill.description).toBe("Get current weather");
    expect(skill.inputSchema).toBeDefined();
    const schema = JSON.parse(skill.inputSchema!);
    expect(schema.type).toBe("object");
  });

  it("handles empty schema", () => {
    const tool: MCPTool = { name: "ping", description: "Ping" };
    const skill = mcpToolToSkill(tool);
    expect(skill.inputSchema).toBeUndefined();
  });

  it("handles empty description", () => {
    const tool: MCPTool = { name: "noop" };
    const skill = mcpToolToSkill(tool);
    expect(skill.description).toBe("");
  });
});

describe("skillToMcpTool", () => {
  it("converts basic skill", () => {
    const skill: Skill = {
      id: "analyze_csv",
      description: "Analyze CSV data",
      inputSchema: JSON.stringify({ type: "object", properties: { path: { type: "string" } } }),
    };
    const tool = skillToMcpTool(skill);
    expect(tool.name).toBe("analyze_csv");
    expect(tool.description).toBe("Analyze CSV data");
    expect(tool.inputSchema?.type).toBe("object");
  });

  it("handles no schema", () => {
    const skill: Skill = { id: "simple", description: "Simple" };
    const tool = skillToMcpTool(skill);
    expect(tool.inputSchema).toEqual({});
  });
});

describe("round-trip", () => {
  it("tool -> skill -> tool", () => {
    const original: MCPTool = {
      name: "translate",
      description: "Translate text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, target_lang: { type: "string" } },
        required: ["text", "target_lang"],
      },
    };
    const skill = mcpToolToSkill(original);
    const recovered = skillToMcpTool(skill);
    expect(recovered.name).toBe(original.name);
    expect(recovered.description).toBe(original.description);
    expect(recovered.inputSchema).toEqual(original.inputSchema);
  });

  it("skill -> tool -> skill", () => {
    const original: Skill = {
      id: "summarize",
      description: "Summarize text",
      inputSchema: JSON.stringify({ type: "object", properties: { text: { type: "string" } } }),
    };
    const tool = skillToMcpTool(original);
    const recovered = mcpToolToSkill(tool);
    expect(recovered.id).toBe(original.id);
    expect(recovered.description).toBe(original.description);
    expect(JSON.parse(recovered.inputSchema!)).toEqual(JSON.parse(original.inputSchema!));
  });
});

describe("mcpToolsToAgentCard", () => {
  it("creates agent card from tools", () => {
    const tools: MCPTool[] = [
      { name: "read_file", description: "Read a file" },
      { name: "write_file", description: "Write a file" },
    ];
    const card = mcpToolsToAgentCard("FileServer", tools, { description: "File operations" });
    expect(card.name).toBe("FileServer");
    expect(card.description).toBe("File operations");
    expect(card.version).toBe("1.0.0");
    expect(card.skills.length).toBe(2);
    expect(card.skills[0].id).toBe("read_file");
  });

  it("handles empty tools", () => {
    const card = mcpToolsToAgentCard("Empty", []);
    expect(card.skills).toEqual([]);
  });

  it("accepts custom version", () => {
    const card = mcpToolsToAgentCard("Test", [], { version: "2.0.0" });
    expect(card.version).toBe("2.0.0");
  });
});
