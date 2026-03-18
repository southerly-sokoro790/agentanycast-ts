import { describe, it, expect } from "vitest";
import { agentCardToDict, agentCardFromDict, type AgentCard, type Skill } from "../src/card.js";

describe("AgentCard", () => {
  it("serializes basic card to dict", () => {
    const card: AgentCard = {
      name: "DataAnalyst",
      description: "Analyzes data",
      skills: [
        { id: "analyze_csv", description: "Analyze CSV" },
        { id: "generate_chart", description: "Generate chart" },
      ],
    };
    const d = agentCardToDict(card);
    expect(d.name).toBe("DataAnalyst");
    expect(d.description).toBe("Analyzes data");
    expect((d.skills as unknown[]).length).toBe(2);
  });

  it("round-trips through dict", () => {
    const card: AgentCard = {
      name: "TestAgent",
      description: "Test",
      version: "2.0.0",
      protocolVersion: "a2a/0.3",
      skills: [
        { id: "s1", description: "skill one", inputSchema: '{"type": "object"}' },
      ],
    };
    const d = agentCardToDict(card);
    const restored = agentCardFromDict(d);
    expect(restored.name).toBe("TestAgent");
    expect(restored.version).toBe("2.0.0");
    expect(restored.skills.length).toBe(1);
    expect(restored.skills[0].id).toBe("s1");
    expect(restored.skills[0].inputSchema).toBe('{"type": "object"}');
  });

  it("includes P2P extension when peerId is set", () => {
    const card: AgentCard = {
      name: "P2PAgent",
      skills: [],
      peerId: "12D3KooWTest",
      supportedTransports: ["tcp", "quic"],
      relayAddresses: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWRelay"],
      didKey: "did:key:zTest",
    };
    const d = agentCardToDict(card);
    const p2p = d.agentanycast as Record<string, unknown>;
    expect(p2p).toBeDefined();
    expect(p2p.peer_id).toBe("12D3KooWTest");
    expect(p2p.did_key).toBe("did:key:zTest");
  });

  it("omits P2P extension when peerId is not set", () => {
    const card: AgentCard = { name: "Simple", skills: [] };
    const d = agentCardToDict(card);
    expect(d.agentanycast).toBeUndefined();
  });
});
