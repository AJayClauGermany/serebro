# The access panel and sandbox checks

## The access panel

The panel titled **What the agent can touch** appears beside the environment form, on the environment page and beside every chat. It is built from the same data as the settings handed to the sandbox, so it always matches what is enforced.

### Header lines

| Line | Meaning |
|---|---|
| **Enforced by** | The sandbox in use, and why: you chose it, or Automatic picked it. |
| **Rules from** | **this environment's settings** (the form), or a **project**, **global** or **custom policy file** with its path. |
| Red box | The environment is blocked and will not start. The text says why. See [Fix common problems](../how-to/troubleshoot.md#the-panel-shows-a-red-box-saying-the-sandbox-will-not-start). |
| ⚠ lines | Warnings. The environment still runs, but something probably needs attention: a missing workspace folder, an agent that is not installed, a masked key whose host is not allowed. |

### Groups

| Group | Label | Meaning |
|---|---|---|
| **Files** | Can read + write | The agent can read and change files here. |
| | Can read | nono only. Read-only paths the agent needs in order to start: its own program files, Node.js, certificates. |
| | Cannot read | Hidden from the agent. |
| | Re-allowed for reading | Readable although a parent folder is hidden. |
| | Never writable | Cannot be changed, even inside a writable folder. Still readable. |
| **Network** | Can connect to | The only domains the agent can reach. |
| | Always blocked | Blocked even if an allowed wildcard matches. |
| | Local ports | Whether the agent can start programs that listen on a port. |
| **Credentials** | Readable by the agent | Direct keys. The agent can see the real value. |
| | Masked (placeholder only) | Masked keys. The agent sees a placeholder. |
| | Not set | Keys with no saved value, and keys this agent usually needs that are not on the list. |

The sentence under **Files** says what happens to every path not listed. With sandbox-runtime: readable but not writable. With nono: only system folders are readable, and nothing is writable.

### Source tags

Each entry has a tag saying why it is there.

| Tag | Meaning |
|---|---|
| **workspace** | The environment's workspace folder. |
| **you** | You added it on the form. |
| **default** | One of the pre-filled hidden folders. |
| **agent** | The selected agent needs it: its settings folder, its model API. |
| **packages** | Added by **Allow package managers**. |
| **policy file** | Comes from the policy file in use. |
| **serebro** | Added by Serebro itself and cannot be removed: the temp folder, the data folder, the policy file locations. |

### Raw settings

At the bottom, **Raw sandbox-runtime settings** (or **Raw nono profile**) shows the exact configuration given to the sandbox. Key values are never included. The panel beside a chat is a shorter version: it leaves out the notes and the raw settings.

## Sandbox checks

**Run checks** on the environment page runs harmless commands inside the sandbox and compares each result with what the rules say should happen.

Each row shows the check, what was **expected** (`allowed` or `blocked`) and the **result**: `pass` when the outcome matched, `FAIL` when it did not. Click **output** under a check to see what the command printed.

| Check | Expected | What it does |
|---|---|---|
| Runs a command | allowed | Runs `echo` inside the sandbox. |
| Writes inside the workspace | allowed | Creates and removes a small file in the workspace. |
| Writes outside the workspace | blocked | Tries to create a file in your home folder. |
| Reads the Serebro data folder | blocked | Tries to list the folder that holds your keys. |
| Changes its own policy file | blocked | Tries to write the project policy file. sandbox-runtime only. |
| Reads a denied path (…) | blocked | Tries to read the first hidden path that exists and has content. Skipped if none does. |
| Reaches a domain not on the list (…) | blocked | Tries to connect to a well-known site you have not allowed. |
| Reaches an allowed domain (…) | allowed | Connects to the agent's model API, or to your first allowed domain. Skipped if nothing is allowed. |
| Commits with git | allowed | nono only. Makes a commit in a scratch repository. |
| Connects to a Unix socket on this machine | blocked | nono on Linux only. |
| Reaches a service on this machine's localhost | blocked | nono only. |

If the environment is blocked, or the workspace folder is missing, you get a single failing row instead: **Sandbox can start** or **Workspace exists**.

The checks test the sandbox, not the agent. They do not call the model and do not use your key. The network checks need `curl` on your machine.
