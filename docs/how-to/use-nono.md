# Use nono when sandbox-runtime cannot run

Serebro can enforce an environment's rules with one of two sandboxes. The default is sandbox-runtime. The other is [nono](https://nono.sh).

Use nono when:

- the home page says **This machine is not ready to run the sandbox** and the suggested fix does not work
- the **bubblewrap can start a sandbox** check fails, which is common inside Docker and other containers
- you cannot install `bubblewrap` or `socat`

## Install nono

Follow nono's [installation instructions](https://nono.sh/docs/cli/getting_started/installation). On macOS with Homebrew:

```bash
brew install nono
```

Refresh the Serebro home page. In the **System** box, the `Sandbox: nono` line should now say **ok**.

If you installed nono somewhere that is not on your `PATH`, tell Serebro where it is and restart the server:

```bash
SEREBRO_NONO_BIN=/path/to/nono pnpm dev
```

## Let Serebro pick it

You may not need to do anything else. Each environment's **Sandbox** setting defaults to **Automatic**, which uses sandbox-runtime when it works and nono when it does not. The dropdown tells you which one it picks on this machine: `Automatic (now: nono)`.

## Pick it yourself

1. Open the environment and click **Edit**.
2. Set **Sandbox** to **nono**.
3. Click **Save changes**.

The panel's first line now reads **Enforced by: nono**.

When you pick a sandbox by name, Serebro never swaps it for the other one. If it cannot run, the environment does not start.

## Adjust the environment for nono

nono cannot enforce every rule sandbox-runtime can. Serebro does not quietly drop such a rule. It refuses to start the environment and shows the reason in a red box in the panel.

Check these four things:

1. **Never writable.** Remove entries that sit inside the workspace or another writable folder, such as `.env`. nono cannot protect a file inside a folder the agent may write. (A new environment created while nono is selected starts with this list empty.)
2. **Hidden (cannot read).** On Linux, remove entries that sit inside the workspace or another folder the agent may use.
3. **Credentials.** Switch any **Masked** credential to **Direct**.
4. **Allow local ports.** On macOS, untick it.

Then expect two differences in how the agent behaves:

- **The agent sees far less of your machine.** With nono it can read only system folders, the workspace, and paths you grant. If it needs to read something elsewhere, such as a sibling project, add that path under **Re-allow reading inside a hidden folder** or **Extra writable folders**.
- **Writable folders must already exist.** Create any extra writable folder yourself before starting a chat. The panel warns you about ones that are missing.

The complete list of differences is in [Sandboxes compared](../reference/sandboxes.md).

## Check your work

Open the environment page and click **Run checks**. With nono the table has extra rows, including **Commits with git** and **Reaches a service on this machine's localhost**. All should pass.
