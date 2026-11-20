# Supported agents

Serebro runs these coding agents. Each must be installed on the machine that runs Serebro, and found on the `PATH` of the terminal that started it.

| Agent | Install | Program looked for | Key it usually needs | Model API domains | Settings folders it writes |
|---|---|---|---|---|---|
| **Claude Code** (Anthropic) | `npm install -g @anthropic-ai/claude-code` | `claude` | `ANTHROPIC_API_KEY` | `api.anthropic.com` | `~/.claude`, `~/.claude.json` |
| **Codex** (OpenAI) | `npm install -g @openai/codex` | `codex` | `CODEX_API_KEY` | `api.openai.com` | `~/.codex` |
| **Grok Build** (xAI) | xAI's `grok` command-line program, see [x.ai](https://x.ai) | `grok` | `XAI_API_KEY` | `api.x.ai` | `~/.grok` |
| **OpenCode** (SST) | `npm install -g opencode-ai` | `opencode` | The key for your model provider (offered: `ANTHROPIC_API_KEY`) | `api.anthropic.com`, `models.dev` | `~/.local/share/opencode`, `~/.config/opencode`, `~/.cache/opencode`, `~/.local/state/opencode` |
| **Pi** (Earendil) | `npm install -g @earendil-works/pi-coding-agent pi-acp` | `pi-acp` | The key for your model provider (offered: `ANTHROPIC_API_KEY`) | `api.anthropic.com` | `~/.pi` |

The key, domains and folders in this table are what Serebro adds or suggests when you pick the agent. They appear in the access panel tagged **agent**.

## Model names offered

The **Model** box accepts any text. These are the suggestions, with the default first.

| Agent | Models |
|---|---|
| Claude Code | `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5` |
| Codex | `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1` |
| Grok Build | `grok-build`, `grok-build-0.1`, `composer-2.5` |
| OpenCode | `anthropic/claude-sonnet-4-5`, `openai/gpt-5.1`, `xai/grok-4` |
| Pi | `default` |

## Things to know about each agent

**All agents** run without asking permission for each command. Their own approval prompts and built-in sandboxes are turned off, because Serebro's sandbox is the boundary. See [How Serebro keeps the agent contained](../explanation/safety-model.md).

**Claude Code** reads the project's own Claude settings (`.claude/` in the workspace). Serebro does not pass its own `ANTHROPIC_API_KEY` on to the agent: add the key under Credentials.

**OpenCode** and **Pi** can use models from several providers. If you choose a provider other than Anthropic, add that provider's key under Credentials and its API domain under **Allowed domains**.

**OpenCode** does not work with sandbox-runtime on Linux yet. Use macOS, or another agent. Local ports are always allowed for it.

**Pi** chooses its model from its own settings file, `~/.pi/agent/settings.json`. The **Model** field has no effect.
