# AgentAnycast TypeScript SDK

TypeScript SDK for AgentAnycast — decentralized A2A agent-to-agent communication over P2P.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

> **AgentAnycast is fully decentralized.** On a local network, it works with zero configuration. For cross-network communication, just deploy your own relay with a single command.

## Installation

```bash
npm install agentanycast
```

## Quick Start

### Server Agent

```typescript
import { Node } from "agentanycast";

const node = new Node({
  card: {
    name: "Echo Agent",
    skills: [{ id: "echo", description: "Echoes back your message" }],
  },
});

await node.start();

node.onTask(async (task) => {
  const text = task.messages[0]?.parts[0]?.text ?? "";
  await task.complete([{ parts: [{ text: `Echo: ${text}` }] }]);
});

await node.serveForever();
```

### Client Agent

```typescript
import { Node } from "agentanycast";

const node = new Node({
  card: { name: "Client", skills: [] },
});

await node.start();

const handle = await node.sendTask(
  { role: "user", parts: [{ text: "Hello!" }] },
  { skill: "echo" },
);

const result = await handle.wait();
console.log(result.artifacts);

await node.stop();
```

## Features

- **End-to-end encrypted** — All communication uses the Noise_XX protocol
- **NAT traversal** — Automatic hole-punching with relay fallback
- **Anycast routing** — Send tasks by skill, not by address
- **DHT discovery** — Decentralized agent discovery via Kademlia DHT
- **DID support** — W3C `did:key` identity for cross-ecosystem interop
- **MCP interop** — Bidirectional MCP Tool ↔ A2A Skill mapping
- **Sidecar architecture** — Go daemon handles networking; SDK communicates via gRPC

## How It Works

```
┌─────────────┐         mDNS / Relay         ┌─────────────┐
│  Agent A    │◄──────────────────────────────►│  Agent B    │
│  (Node.js)  │     E2E encrypted (Noise)     │  (Node.js)  │
└──────┬──────┘                               └──────┬──────┘
       │ gRPC                                        │ gRPC
┌──────┴──────┐                               ┌──────┴──────┐
│  Daemon A   │◄──────── libp2p ──────────────►│  Daemon B   │
│  (Go)       │   Noise_XX + Yamux + QUIC     │  (Go)       │
└─────────────┘                               └─────────────┘
```

The SDK communicates with a local Go daemon over gRPC. The daemon handles all P2P networking, encryption, and protocol logic.

## API Reference

| Export | Description |
|--------|-------------|
| `Node` | Main entry point — start, stop, send/receive tasks |
| `AgentCard` / `Skill` | Agent capability descriptors |
| `TaskHandle` | Track outgoing task progress |
| `DaemonManager` | Manage daemon binary lifecycle |
| `GrpcClient` | Low-level gRPC client (advanced) |
| `peerIdToDIDKey` / `didKeyToPeerId` | W3C DID conversion |
| `mcpToolToSkill` / `skillToMcpTool` | MCP interoperability |

## License

Apache License 2.0 — see [LICENSE](LICENSE).
