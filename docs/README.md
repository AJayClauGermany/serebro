# Serebro user guides

Serebro runs a coding agent (Claude Code, Codex and others) inside a sandbox on your own machine. You decide which folder it works in, which websites it can reach and which keys it gets. Then you chat with it.

These guides are for people using Serebro. They do not cover how it is built: for that, see the [project README](../README.md).

The guides follow the [Diátaxis](https://diataxis.fr/) layout, so each page does one job. Pick by what you need right now:

| I want to… | Go to |
|---|---|
| **Learn** by doing, from nothing to a working agent | [Tutorial: Your first sandboxed agent](tutorials/first-sandboxed-agent.md) |
| **Get a task done** | [How-to guides](#how-to-guides) |
| **Look something up** | [Reference](#reference) |
| **Understand** how the pieces fit | [Explanation](#explanation) |

New here? Do the tutorial first. It takes about 20 minutes and every other page assumes you have done it.

## Tutorial

- [Your first sandboxed agent](tutorials/first-sandboxed-agent.md): install Serebro, create an environment, test it, chat with the agent, watch the sandbox block something, then allow it.

## How-to guides

- [Give the agent network access](how-to/allow-network-access.md): package installs, extra websites, dev servers.
- [Control which files the agent can use](how-to/control-file-access.md): share more folders, hide folders, protect files.
- [Give the agent API keys](how-to/manage-credentials.md): add, replace and mask keys.
- [Change the rules during a chat](how-to/change-rules-during-a-chat.md)
- [Use nono when sandbox-runtime cannot run](how-to/use-nono.md): containers, missing tools.
- [Use your own policy file](how-to/use-a-policy-file.md): keep the rules in a file next to your code.
- [Fix common problems](how-to/troubleshoot.md): "will not start", failed checks, "Run failed".

## Reference

- [Environment settings](reference/environment-settings.md): every field on the environment form.
- [The access panel and sandbox checks](reference/access-panel.md): what each label, tag and check means.
- [Supported agents](reference/agents.md): install commands, keys and domains for each agent.
- [Sandboxes compared](reference/sandboxes.md): sandbox-runtime and nono side by side.
- [Server settings and data](reference/server-settings.md): environment variables and where Serebro keeps its files.

## Explanation

- [Core concepts](explanation/concepts.md): environment, workspace, agent, sandbox and chat, and how they relate.
- [How Serebro keeps the agent contained](explanation/safety-model.md): what the sandbox does and does not protect.
