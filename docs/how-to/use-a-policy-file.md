# Use your own policy file

By default you set an environment's file and network rules on its form. You can keep them in a file instead. This is useful when:

- you want the rules stored next to the code and shared with your team
- you already have a sandbox-runtime settings file
- you need a sandbox-runtime option the form does not offer

A policy file is a sandbox-runtime settings file in JSON. Policy files only work with the sandbox-runtime sandbox, not with nono.

When a file is in use, it **replaces** the **Files** and **Network access** settings on the form. Credentials still come from the form: keys do not belong in a file that might be committed.

## Create a policy file from your current settings

1. Open the environment page.
2. Find the **Policy file** box.
3. Click **+ Project file (.srt-settings.json in workspace)**. An editor opens, filled in with your current Files and Network settings.
4. Edit if you want to, then click **Validate & save**.

The file is written to `<workspace>/.srt-settings.json`. The panel on the right now says **Rules from: project policy file**, and entries that came from the file are tagged **policy file**.

To share one file across every project on your machine, click **+ Global file (~/.srt-settings.json)** instead. A project file wins over the global file.

## Use a file you already have

If the file is at `<workspace>/.srt-settings.json` or `~/.srt-settings.json`, there is nothing to do. With the **Policy file** setting on **Auto** (the default), Serebro finds and uses it.

If the file is somewhere else:

1. Click **Edit** on the environment.
2. Open the **Policy file** section and choose **Custom file**.
3. Type the path. It can be absolute, start with `~/`, or be relative to the workspace.
4. Click **Save changes**.

With **Custom file**, a missing file is an error. The environment will not start until the file exists.

## Edit the file

Use either:

- the editor in the **Policy file** box on the environment page, which checks the file before saving and refuses to save one that is invalid
- your own editor. Serebro reads the file again before every message. If you have the environment page open, click **↻ Reload from disk** to see your changes.

Changes apply from the next message. An open chat shows a **Sandbox policy changed** bar. See [Change the rules during a chat](change-rules-during-a-chat.md).

The format is described in the [sandbox-runtime documentation](https://github.com/anthropic-experimental/sandbox-runtime#configuration). A small example:

```json
{
  "filesystem": {
    "allowWrite": ["."],
    "denyRead": ["~/.ssh", "~/.aws"],
    "denyWrite": [".env"]
  },
  "network": {
    "allowedDomains": ["registry.npmjs.org", "*.example.com"],
    "deniedDomains": []
  }
}
```

Keep `"."` in `allowWrite`. Without it the workspace is not writable and the agent cannot edit your code. The panel warns you if it is missing.

## Decide whether Serebro adds what the agent needs

Your file probably does not list the agent's own settings folder or its model API domain. By default Serebro adds them for you, and they show in the panel tagged **agent**.

To use the file exactly as written:

1. Click **Edit** on the environment.
2. Open the **Policy file** section.
3. Untick **When a file is used, also allow what <agent> needs**.
4. Click **Save changes**.

You must then list the agent's folders and domains in the file yourself. They are in [Supported agents](../reference/agents.md).

Whatever you choose, Serebro always adds a private temp folder, hides its own data folder, and blocks writes to every policy file.

## Go back to the form settings

1. Click **Edit** on the environment.
2. Open the **Policy file** section and choose **Off**.
3. Click **Save changes**.

The file stays on disk but is ignored.

## Check your work

The panel's **Rules from** line tells you which source is in use. Then click **Run checks** on the environment page. The **Changes its own policy file** row confirms the agent cannot edit the file.
