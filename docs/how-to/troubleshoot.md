# Fix common problems

Find the message or symptom you are seeing.

- [The home page says "This machine is not ready to run the sandbox"](#the-home-page-says-this-machine-is-not-ready-to-run-the-sandbox)
- [The panel shows a red box saying the sandbox "will not start"](#the-panel-shows-a-red-box-saying-the-sandbox-will-not-start)
- [A sandbox check says FAIL](#a-sandbox-check-says-fail)
- [The chat shows "Run failed"](#the-chat-shows-run-failed)
- [The agent says a command was blocked](#the-agent-says-a-command-was-blocked)
- [The agent stopped part-way through](#the-agent-stopped-part-way-through)
- [The agent's tag says "not installed"](#the-agents-tag-says-not-installed)
- [Saving the environment shows an error](#saving-the-environment-shows-an-error)
- [I cannot open Serebro from another machine](#i-cannot-open-serebro-from-another-machine)

## The home page says "This machine is not ready to run the sandbox"

Neither sandbox can run. The red box lists each missing tool with the command that installs it.

1. Run the listed commands.
2. Refresh the page.

If **bubblewrap can start a sandbox** still fails after installing, your machine (often a container) does not allow what bubblewrap needs. [Use nono instead](use-nono.md).

## The panel shows a red box saying the sandbox "will not start"

The environment is blocked. Serebro blocks an environment when it cannot enforce a rule exactly as written. It never drops the rule and carries on. The box gives the reason:

| The box says | Do this |
|---|---|
| **… cannot run on this machine** | The sandbox chosen for this environment is missing tools. Install them, or click **Edit** and set **Sandbox** to **Automatic**. |
| **Policy file … is invalid** | Open the **Policy file** box on the environment page. It lists each error. Fix the file and click **Validate & save**. |
| **File not found** for a policy file | The environment is set to **Custom file** and the file is missing. Create it, fix the path, or set **Policy file** to **Auto** or **Off**. |
| **Policy files are sandbox-runtime files and nono cannot use them** | Click **Edit**, then **Save changes**. The form turns policy files off when the sandbox is nono. |
| **nono cannot enforce this rule** | The box names the rule. Remove it, or set **Sandbox** to **sandbox-runtime**. See [Adjust the environment for nono](use-nono.md#adjust-the-environment-for-nono). |
| **nono refuses this environment** | nono itself rejected the settings, and its message follows. The usual cause is **Allow local ports** on a machine without user namespaces: untick it. |

## A sandbox check says FAIL

Click **output** under the check's name to see what the command printed.

| Check | Likely cause |
|---|---|
| **Sandbox can start** | The environment is blocked. See the section above. |
| **Workspace exists** | The workspace folder is missing. Create it or fix the path under **Edit**. |
| **Runs a command** | The sandbox tools are installed but cannot start. Check the **System** box on the home page. |
| **Writes inside the workspace** | You do not have write permission on the workspace folder yourself, or a policy file leaves `"."` out of `allowWrite`. |
| **Reaches an allowed domain** | Your machine has no internet access, or it needs a company proxy. Start Serebro with `HTTPS_PROXY` set to your proxy's address. |
| **Reaches a domain not on the list** | The network rules allow more than you meant. Look for a broad wildcard under **Can connect to**. |
| Any check expected **blocked** that was **allowed** | Do not use the environment until this is understood. Open **Raw sandbox-runtime settings** (or **Raw nono profile**) at the bottom of the panel, and report it as a bug with that output. |

## The chat shows "Run failed"

The agent did not start, or it stopped with an error. Check three things, in this order:

1. **Is the agent installed?** Open the environment page. The tag next to the agent's name must say **installed**. If not, see [below](#the-agents-tag-says-not-installed).
2. **Is its key set?** In the panel, the **Not set** group under **Credentials** must be empty. If the agent's key is listed there, [add it](manage-credentials.md). If the key is set but wrong or expired, the error usually mentions `401` or "authentication".
3. **Can it reach its model?** The agent's model API domain must be under **Can connect to**. Click **Run checks**: the **Reaches an allowed domain** row tests it.

If the message says the sandbox will not start, see [the section above](#the-panel-shows-a-red-box-saying-the-sandbox-will-not-start).

## The agent says a command was blocked

This is the sandbox working. Decide whether the agent should have that access, and if so:

- A network error (a `403` from the proxy, "could not resolve host", a timeout): [allow the domain](allow-network-access.md#allow-a-specific-website-or-api).
- "Read-only file system" or "Permission denied" when writing: [make the folder writable](control-file-access.md#let-the-agent-work-in-a-second-folder), or check the file is not under **Never writable**.
- "No such file" or an empty folder when reading something you know exists: the path is hidden, or with nono it was never granted. See [Control which files the agent can use](control-file-access.md).
- An error when starting a server that listens on a port: [allow local ports](allow-network-access.md#let-the-agent-run-a-dev-server).

Then send your message again.

## The agent stopped part-way through

Serebro stops a task that runs for more than 60 minutes, or that produces no output for 15 minutes. The chat says which limit was reached.

Send a message asking the agent to continue. It keeps its memory of the conversation.

To change the limits, see [Server settings and data](../reference/server-settings.md).

## The agent's tag says "not installed"

Serebro looks for the agent's program on the `PATH` of the terminal that started the server.

1. Install the program. The command is on the environment form under the agent buttons, and in [Supported agents](../reference/agents.md).
2. If it is installed but still not found, stop Serebro, open a new terminal where the program runs when you type its name, and start Serebro from there.

## Saving the environment shows an error

| Message | Fix |
|---|---|
| **Name is required** | Fill in **Name**. |
| **Workspace must be an absolute path (or start with ~)** | Use a full path such as `/home/you/code/app` or `~/code/app`. Relative paths are not accepted. |
| **"…" is not a valid environment variable name** | A credential name may contain only letters, digits and underscores, and cannot start with a digit. |
| **Enter the path of the custom policy file** | You chose **Custom file** but left the path empty. |

## I cannot open Serebro from another machine

This is deliberate. Serebro has no login, so by default it only answers requests from the machine it runs on. To put it behind a proxy that handles login, see [Server settings and data](../reference/server-settings.md#reaching-serebro-from-another-machine).
