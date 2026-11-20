# Sandboxes compared

Serebro can enforce an environment's rules with either of two sandboxes. This page lists how they differ. To switch, see [Use nono when sandbox-runtime cannot run](../how-to/use-nono.md).

## What each needs

| | sandbox-runtime (srt) | nono |
|---|---|---|
| Linux | `bubblewrap`, `socat`, `ripgrep`, and a machine that lets bubblewrap start | The `nono` program. Linux 5.13 or newer with Landlock. |
| macOS | `ripgrep` | The `nono` program |
| Windows | Not supported. Use WSL2. | WSL2 |

## What each can enforce

"Blocked" means Serebro refuses to start the environment while the rule is present. It never ignores a rule.

| Rule or feature | sandbox-runtime | nono |
|---|---|---|
| **Reading files** | Everything is readable except hidden paths | Only system folders, the workspace and paths you grant are readable. Your home folder is hidden by default. |
| **Hiding a path inside a folder the agent may use** (such as `.env` in the workspace) | Yes | macOS only. Blocked on Linux. |
| **Never writable inside a writable folder** | Yes | No. Blocked. |
| **Masked credentials** | Yes (experimental) | No. Blocked. |
| **Policy files** | Yes | No. The form turns them off. |
| **Allow local ports** | Yes | Linux only, where user namespaces are available. Blocked on macOS. |
| **Writable folders that do not exist yet** | The agent can create them | The agent cannot. Serebro creates the agent's own folders and warns about the rest. |

## What the agent can see and do beyond the rules

| | sandbox-runtime | nono |
|---|---|---|
| **Other running programs** | Hidden | Visible: names and command lines. Their environment variables too, if Serebro runs as root. |
| **Services on this machine's localhost** | Not reachable on Linux | Not reachable |
| **Unix sockets** (Docker, ssh-agent) | Blocked | Blocked on Linux for sockets with a file path. Abstract sockets are only blocked on Linux 6.12 or newer. |
| **Shared memory (`/dev/shm`)** | A private one per sandbox | Not available. Some tools fail, for example Python `multiprocessing` and pytest-xdist. |
| **Changing permissions (`chmod`) on your files outside the workspace** | Blocked | Not blocked. Changing content, deleting and renaming are blocked. |

## How Automatic chooses

1. sandbox-runtime, if its tools are installed and bubblewrap can start a full sandbox.
2. Otherwise nono, if it is installed.
3. If neither can run, the environment is blocked and the home page lists what to install.

The **System** box on the home page shows which one Automatic uses on this machine.
