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

## Using your own policy file

If you already have a sandbox-runtime config, Serebro can use it instead of the Files and Network settings. Each environment has a **Policy file** setting:

| Mode | What it uses |
|---|---|
| **Auto** (default) | `<workspace>/.srt-settings.json` if it exists, else `~/.srt-settings.json` (srt's own default file), else the environment settings |
| **Custom** | A file you name (absolute, `~/…`, or relative to the workspace). If it is missing, the sandbox will not start. |
| **Off** | Always use the environment settings |

When a file is in use:

- Its rules replace the Files and Network settings. Other keys (`ignoreViolations`, `allowUnixSockets`, …) pass through unchanged.
- By default Serebro adds the agent's config folders and model API domain on top (you can turn this off). It always adds a private temp folder, hides its own data folder, and blocks writes to every policy file, so **the agent cannot change its own rules**.
- Credentials still come from Serebro. Keys don't belong in a file that might be committed.
- The file is validated against srt's schema before every run. If it's invalid, the run stops with the error and nothing starts without a sandbox.

**Editing:** the environment page has an editor. It shows which file is in use, can create a project or global file from the current settings, and validates before saving. Edits made in your own editor are picked up too. Every agent message starts a fresh sandboxed process, so changes apply from the next message. Open chats show a **Sandbox policy changed** bar with **Reload sandbox**, which also stops a running turn.

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

### Errors (Effect)

The server code uses [Effect](https://effect.website) v4 (stable modules only) so failures are typed and handled in one place:

- **Expected failures are tagged errors** (`src/lib/server/errors.ts`): `NotFound`, `InvalidInput`, `PolicyInvalid`, `SandboxBlocked`, `FileSystemError`, `StoreCorrupt`. Each function's type lists the ones it can fail with.
- **`src/lib/server/http.ts`** runs route effects and maps each error to a status in one exhaustive switch. Anything unexpected is logged with its full cause and the client gets a generic 500.
- **Everything crossing a boundary is validated with `Schema`** (`src/lib/server/schemas.ts`): request bodies, and every data file when it is read. A corrupt data file fails loudly and is never overwritten.
- **`Store`** (`src/lib/server/store.ts`) is an Effect service; its writes run one at a time so concurrent requests cannot lose updates.
- **Environment variables** are validated at startup (`src/lib/server/config.ts`); a bad value stops the server with a clear message.

## Data

Everything is stored in `./.serebro` (change it with `SEREBRO_DATA_DIR`):

- `environments.json`: environment configs, with no secrets
- `secrets.json`: credential values (file mode 0600). They are never sent to the browser, and the sandbox cannot read this folder.
- `sessions.json`, `messages/`: chats
- `sandboxes/<id>/srt-settings.json`: generated sandbox config (the effective one, including Serebro's additions)

### Security

Serebro has no login: anyone who can reach its API can run agents on your machine. So by default it only answers requests that:

- come from this machine (loopback). Other machines on the network are refused.
- use a local `Host` (`localhost`, `127.0.0.1`, `::1`). This blocks DNS-rebinding attacks.
- come from Serebro's own pages, when the browser sends an `Origin`. Other websites are refused.
- are JSON, for API writes. Browsers cannot send JSON cross-site without permission.

To put it behind your own authenticating proxy, set `SEREBRO_ALLOWED_HOSTS=serebro.example.com` and `SEREBRO_ALLOW_REMOTE=1`.

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
pnpm test     # unit tests (vitest + @effect/vitest)
```
