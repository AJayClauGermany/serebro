# Control which files the agent can use

This guide shows how to widen or narrow the agent's access to files.

All of these settings are in the **Files** section of the environment form. To get there, open the environment and click **Edit**, or click **Change access** from a chat. After each change, check the **Files** group in the panel on the right, then click **Save changes**.

The starting point, with the default sandbox (sandbox-runtime):

- The agent can **write** only in the workspace, its own settings folder and a private temp folder.
- The agent can **read** almost everything you can, except a pre-filled list of folders that usually hold logins.

Paths can be absolute (`/srv/data`) or start with `~/`. In **Never writable**, a path with neither is taken as inside the workspace.

> The nono sandbox treats reading differently and cannot enforce some of the rules below. If the panel says **Enforced by: nono**, read [Sandboxes compared](../reference/sandboxes.md) first.

## Let the agent work in a second folder

Use this when the task spans two projects, for example an app and a shared library.

1. Open **Files**.
2. Under **Extra writable folders**, type the folder path and click **+ Add**.
3. Save.

The folder appears under **Can read + write**, tagged **you**.

## Hide a folder from the agent

Use this for anything the agent has no reason to see: personal documents, other clients' code, password stores.

1. Open **Files**.
2. Under **Hidden (cannot read)**, type the path and click **+ Hide**.
3. Save.

The path appears under **Cannot read**. To the agent, a hidden folder looks empty or cannot be opened.

Keep the pre-filled entries (`~/.ssh`, `~/.aws` and the rest) unless you have a specific reason to remove one.

## Show one part of a hidden folder

1. Hide the outer folder as above, for example `~/Documents`.
2. Under **Re-allow reading inside a hidden folder**, add the inner path, for example `~/Documents/specs`.
3. Save.

## Stop the agent changing a file in the workspace

Use this for files the agent may read but must not edit: lock files, migration history, CI configuration.

1. Open **Files**.
2. Under **Never writable**, type the path and click **+ Protect**. A relative path such as `.env` or `db/migrations` is taken as inside the workspace.
3. Save.

New environments start with `.env` and `.env.local` protected.

**Protected is not hidden.** The agent can still read a protected file. If the file holds secrets, also add it under **Hidden (cannot read)**, using its full path (for example `~/code/my-app/.env`).

## Check your work

Open the environment page and click **Run checks**. To test a specific path yourself, start a chat and ask the agent to read or change it, as you did in the [tutorial](../tutorials/first-sandboxed-agent.md#step-7-watch-the-sandbox-say-no).

## Things the agent can never do

Whatever you set, the agent cannot:

- read Serebro's own data folder, where your keys are stored
- change the sandbox's policy files, so it cannot rewrite its own rules
- with sandbox-runtime, change your shell startup files or `.git/hooks`

These show in the panel tagged **serebro**.
