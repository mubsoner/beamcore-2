# BeamCore

BeamCore is an AI-powered development workspace for creating, editing, running, and previewing full-stack projects.

## Product architecture

- **AI orchestration:** Groq is the configured primary model provider.
- **Agent actions:** BeamCore turns project requests into structured file and command operations.
- **Remote runtime:** Daytona provides the Linux sandbox used to write project files and execute commands.
- **Live Preview:** BeamCore exposes a running project through the remote sandbox preview URL.
- **Workbench:** The editor, terminal, and preview surface project files and runtime activity.

The browser WebContainer integration is retained only as a compatibility fallback while the remote runtime is being validated.

## Development

Install dependencies with `pnpm install`, then start the development server with `pnpm dev`.

Run tests with `pnpm test` and static type checks with `pnpm typecheck`.

## Deployment configuration

The Vercel deployment uses the Node-compatible Remix server entry and the `build:vercel` build script.

Configure secrets in the deployment platform rather than committing them:

- `AI_PROVIDER=groq`
- `GROQ_API_KEY`
- `DAYTONA_API_KEY`

Never expose provider or sandbox secrets to browser code or commit them to source control.

## Runtime behavior

A project build is only considered successful when generated files are saved in the sandbox, required commands finish or the development server becomes ready, and a valid Preview URL is published. A normal text response from the model alone does not mean a project was created.

## License

This repository retains the license and third-party notices included with its upstream dependencies.