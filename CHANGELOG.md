# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-03-18

### Added

- `Node` class — manages daemon lifecycle and gRPC communication
- `GrpcClient` — full gRPC client with proto/SDK type converters and error mapping
- `AgentCard` and `Skill` interfaces with JSON serialization
- `TaskHandle` for tracking outgoing tasks with `wait()` and `cancel()`
- `IncomingTask` for receiving and responding to tasks
- `DaemonManager` for auto-downloading and managing the daemon binary
- `peerIdToDIDKey` / `didKeyToPeerId` — W3C DID interoperability
- `mcpToolToSkill` / `skillToMcpTool` — MCP Tool mapping
- Full exception hierarchy (18 classes)
- CI pipeline with proto freshness check and multi-version test matrix (Node 18/20/22)

[0.3.0]: https://github.com/AgentAnycast/agentanycast-ts/releases/tag/v0.3.0
