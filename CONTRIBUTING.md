# Contributing

Thank you for your interest in contributing to AgentAnycast!

Please see the [Contributing Guide](https://github.com/AgentAnycast/agentanycast/blob/main/CONTRIBUTING.md) in the main repository for guidelines on:

- Contribution workflow
- Coding standards
- Commit message conventions
- Cross-repository changes
- DCO sign-off requirements

## TypeScript SDK-Specific Guidelines

- Run `npm run build` to verify the project compiles
- Run `npm test` before submitting
- All public APIs must have JSDoc comments and TypeScript type annotations
- Do not modify files under `src/generated/` — those are auto-generated from proto
- Follow the existing code style (2-space indent, strict TypeScript)
