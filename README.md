# Serebro

A web control panel for running coding agents inside a sandbox you control.

You create an **environment**: the project folder the agent works in, the agent to run, and exactly which files, websites and keys it can use. Serebro shows you what the agent can and cannot touch, lets you test the sandbox with one click, then gives you a chat with the agent.

- **Sandbox:** [Anthropic sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) (`srt`): bubblewrap on Linux, Seatbelt on macOS, plus a filtering network proxy.
- **Agents:** Claude Code, Codex, Grok Build, OpenCode and Pi, through the [TanStack AI](https://tanstack.com/ai) harness adapters.
- **UI:** SvelteKit + `@tanstack/ai-svelte`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173, click **New environment**, fill it in, then **Run checks** and **New chat**.

### Requirements

| | Linux | macOS |
|---|---|---|
| Node.js 20+ | ✔ | ✔ |
| Sandbox tools | `bubblewrap`, `socat`, `ripgrep` (`sudo apt-get install bubblewrap socat ripgrep`) | `ripgrep` (`brew install ripgrep`) |
| The agent's CLI | see below | see below |

The home page lists anything missing.

| Agent | Install | Key it needs | Model API domain |
|---|---|---|---|
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` | `api.anthropic.com` |
| Codex | `npm i -g @openai/codex` | `CODEX_API_KEY` | `api.openai.com` |
| Grok Build | xAI's `grok` CLI | `XAI_API_KEY` | `api.x.ai` |
| OpenCode | `npm i -g opencode-ai` | the model provider's key | the provider's API + `models.dev` |
| Pi | `npm i -g @earendil-works/pi-coding-agent pi-acp` | the model provider's key | the provider's API |

## What an environment controls

| Area | Default | You can change |
|---|---|---|
| **Files: write** | Blocked everywhere except the workspace, the agent's own config folder (for example `~/.claude`) and a private temp folder | Add writable folders, protect files such as `.env` |
| **Files: read** | Allowed, except for folders that usually hold logins (`~/.ssh`, `~/.aws`, `~/.gnupg`, …) and Serebro's own data folder | Hide more paths, re-allow sub-paths |
| **Network** | Blocked except the agent's model API | Add domains, package registries, local ports, block lists |
| **Credentials** | The agent gets **no** environment variables from your machine | Add keys as **direct** (agent can read them) or **masked** (agent sees a placeholder, and the real value is only sent to the hosts you list) |

The access panel and the enforced sandbox settings are built by one function (`src/lib/server/policy.ts`), so what you see is what runs. Expand **Raw sandbox-runtime settings** to see the exact config.

## How it works

```
Browser (Svelte, createChat) ──SSE── /api/chat
                                        │ chat({ adapter: claudeCodeText(...), middleware: [withSandbox(...)] })
                                        ▼
                              srtSandbox provider  (src/lib/server/srt-provider.ts)
                                        │ every command → srt --settings <env>.json -c '<command>'
                                        ▼
                              agent CLI inside bubblewrap/Seatbelt + filtering proxy
```

`srtSandbox` is a TanStack AI `SandboxProvider`. It reuses the local-process handle and wraps every command the agent runs in `srt`. Each environment gets its own generated settings file.

## Data

Everything is stored in `./.serebro` (change it with `SEREBRO_DATA_DIR`):

- `environments.json`: environment configs, with no secrets
- `secrets.json`: credential values (file mode 0600). They are never sent to the browser, and the sandbox cannot read this folder.
- `sessions.json`, `messages/`: chats
- `sandboxes/<id>/srt-settings.json`: generated sandbox config

Serebro has no login. Run it on `localhost` only.

## Known limitations

- **OpenCode on Linux:** OpenCode runs an HTTP server that the host must reach, and the Linux sandbox has its own network namespace. Use macOS or another agent for now.
- **Pi** picks its model from its own settings (`~/.pi/agent/settings.json`), not from Serebro.
- **Masked credentials** use sandbox-runtime's experimental TLS-terminating proxy. Some clients that pin certificates will reject it.
- Agents run unattended inside the sandbox (no per-command approval prompts). The sandbox is the boundary.
- Upstream proxies: `HTTPS_PROXY`/`HTTP_PROXY` on the Serebro server are passed to `srt`, which uses them as a parent proxy.

## Scripts

```bash
pnpm dev      # dev server
pnpm build    # production build (adapter-node) → node build
pnpm check    # type-check
```
