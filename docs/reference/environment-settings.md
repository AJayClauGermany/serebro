# Environment settings

Every field on the **New environment** and **Edit environment** forms, in the order they appear.

## General

| Field | Required | Default | Meaning |
|---|---|---|---|
| **Name** | Yes | none | A label for you. Shown on the home page and in chat titles. |
| **Workspace folder** | Yes | none | The folder the agent starts in and can always read and write. Must be an absolute path or start with `~`. |
| **Coding agent** | Yes | Claude Code | Which agent runs. See [Supported agents](agents.md). Picking an agent sets the model to that agent's default and offers its usual key under Credentials. |
| **Model** | No | The agent's default | The model name passed to the agent. The box suggests known names and accepts any text. Pi ignores this field. |
| **Sandbox** | Yes | Automatic | What enforces the rules. See [below](#sandbox). |

A chat keeps the agent and model the environment had when the chat was created. Changing them affects new chats only.

### Sandbox

| Option | What runs |
|---|---|
| **Automatic** | sandbox-runtime when it can fully run on this machine, otherwise nono. The option shows the current pick: `Automatic (now: …)`. |
| **sandbox-runtime (srt)** | Always sandbox-runtime. If it cannot run, the environment does not start. |
| **nono** | Always nono. If it is not installed, the environment does not start. |

See [Sandboxes compared](sandboxes.md).

## Policy file

Hidden when the sandbox is nono.

| Option | Meaning |
|---|---|
| **Auto** (default) | Use `<workspace>/.srt-settings.json` if it exists, otherwise `~/.srt-settings.json` if it exists, otherwise the form. |
| **Custom file** | Always use the file at the path you give: absolute, `~/…`, or relative to the workspace. A missing file blocks the environment. |
| **Off** | Ignore policy files. Always use the form. |
| **When a file is used, also allow what the agent needs** (default on) | Adds the agent's settings folders and model API domains on top of the file. |

When a file is in use, the **Files** and **Network access** sections are not used. See [Use your own policy file](../how-to/use-a-policy-file.md).

## Files

Paths are absolute or start with `~/`.

| Field | Default | Meaning |
|---|---|---|
| **Extra writable folders** | empty | Folders the agent can read and write, in addition to the workspace. |
| **Hidden (cannot read)** | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`, `~/.azure`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.git-credentials`, `~/.config/gh` | Paths the agent cannot read. |
| **Re-allow reading inside a hidden folder** | empty | Paths the agent can read even though a parent is hidden. With nono, also grants reading a path outside the workspace. |
| **Never writable** | `.env`, `.env.local` (empty when the sandbox is nono) | Paths the agent cannot write, even inside a writable folder. A relative path is inside the workspace. The agent can still read them. |

Always added, and not editable:

| Entry | Where it shows | Why |
|---|---|---|
| The workspace | Can read + write | The agent's working folder. |
| The agent's settings folders | Can read + write | The agent stores its own settings and conversation history there. Listed per agent in [Supported agents](agents.md). |
| `~/.cache/serebro/tmp/<environment id>` | Can read + write | A private temp folder. The agent's `TMPDIR` points here. |
| The Serebro data folder | Cannot read, Never writable | It holds your stored keys. |
| The policy file locations | Never writable | So the agent cannot change its own rules. Not added with nono. |

## Network access

| Field | Default | Meaning |
|---|---|---|
| **Allow <agent>'s model API** | On | Allows the domains the agent needs to reach its model. |
| **Allow package managers** | Off | Allows the domains listed below. |
| **Allow local ports** | Off | Lets the agent start programs that listen on a port. Always on for OpenCode. |
| **Allowed domains** | empty | Extra domains the agent can reach. `*.example.com` matches every subdomain, but not `example.com` itself. |
| **Always blocked** | empty | Domains that stay blocked even when an allowed wildcard matches. |

Everything not allowed is blocked.

**Allow package managers** adds:

| For | Domains |
|---|---|
| npm, Yarn | `registry.npmjs.org`, `registry.yarnpkg.com` |
| Python | `pypi.org`, `files.pythonhosted.org` |
| Rust | `crates.io`, `index.crates.io`, `static.crates.io` |
| Go | `proxy.golang.org`, `sum.golang.org` |
| GitHub | `github.com`, `codeload.github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com` |

## Credentials

Each row is one environment variable given to the agent.

| Field | Meaning |
|---|---|
| **Variable name** | Letters, digits and underscores. Cannot start with a digit. |
| **Value** | Stored on the Serebro server. Never sent back to the browser: afterwards the box shows only the last four characters. Leave it empty when editing to keep the saved value. |
| **Mode: Direct** (default) | The agent receives the real value. |
| **Mode: Masked** | The agent receives a placeholder. The sandbox swaps in the real value on HTTPS requests to the listed hosts. Experimental. sandbox-runtime only. |
| **Send the real value only to** | Masked mode only. The hosts that receive the real value. Empty means every allowed domain. |

The agent receives no other environment variables from your machine, apart from a few Serebro sets itself (such as `TMPDIR`).

## Actions on the environment page

| Button | Effect |
|---|---|
| **▶ New chat** | Creates a chat in this environment and opens it. |
| **Edit** | Opens this form. |
| **Delete** | Deletes the environment, its stored keys and its chats, after you confirm. Files in the workspace are not touched. |
| **Run checks** | Runs the [sandbox checks](access-panel.md#sandbox-checks). |
