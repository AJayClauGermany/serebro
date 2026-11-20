# Tutorial: Your first sandboxed agent

In this tutorial you will run Claude Code inside a sandbox, on a practice project, and see for yourself what the sandbox allows and blocks. By the end you will have:

- Serebro running on your machine
- an **environment** that describes what the agent may touch
- a passing sandbox test
- a chat in which the agent creates a file, is blocked from a website, and is then allowed to reach it

It takes about 20 minutes. Follow the steps in order and use the exact names given: later steps depend on them.

## Before you start

You need:

- A Linux or macOS machine. (On Windows, use WSL2.)
- [Node.js](https://nodejs.org) 20 or newer and [pnpm](https://pnpm.io/installation).
- An Anthropic API key. It starts with `sk-ant-`. You can create one in the [Anthropic Console](https://console.anthropic.com/).

The tutorial uses Claude Code. Serebro supports other agents too, and they work the same way. You can switch after you finish.

## Step 1: Install the tools

Install the sandbox tools.

On Linux (Debian or Ubuntu):

```bash
sudo apt-get install bubblewrap socat ripgrep
```

On macOS:

```bash
brew install ripgrep
```

Then install the Claude Code command-line program:

```bash
npm install -g @anthropic-ai/claude-code
```

## Step 2: Start Serebro

Get the code and start the server:

```bash
git clone https://github.com/AJayClauGermany/serebro.git
```

```bash
cd serebro
```

```bash
pnpm install
```

```bash
pnpm dev
```

Leave this terminal running. Open <http://localhost:5173> in your browser.

You should see the home page with a **No environments yet** box. Look at the **System** box at the bottom right. Every line should have a green **ok** tag, except one sandbox line: `Sandbox: nono` may say **missing**, and that is fine. You only need one sandbox.

> If you see a red box titled **This machine is not ready to run the sandbox**, it lists what is missing and the command to fix it. Run that command, then refresh the page. If the fix does not work on your machine (this is common inside containers), follow [Use nono when sandbox-runtime cannot run](../how-to/use-nono.md) and then come back.

## Step 3: Make a practice project

The agent will work in a real folder on your machine. For this tutorial, use a new empty one so nothing important is at stake.

Open a second terminal and run:

```bash
mkdir ~/serebro-demo
```

```bash
echo "PASSWORD=hunter2" > ~/serebro-demo/.env
```

The `.env` file stands in for a file you would not want an agent to change.

## Step 4: Create an environment

An environment is a saved set of rules: which folder, which agent, and what the agent can use.

1. Click **Create your first environment**.
2. In **Name**, type `Demo`.
3. In **Workspace folder**, type `~/serebro-demo`.
4. Under **Coding agent**, leave **Claude Code** selected. Its tag should say **installed**.
5. Leave **Model** and **Sandbox** as they are.
6. Scroll down to **Credentials**. There is one row, already named `ANTHROPIC_API_KEY`. Paste your API key into the **value** box next to it.

Do not click save yet. Look at the yellow-headed panel on the right, **What the agent can touch**. It updates as you type, and it is the most important thing on the page. Read it top to bottom:

- **Can read + write** lists your `serebro-demo` folder, Claude Code's own settings folder (`~/.claude`), and a private temp folder. The agent can change files in these places and nowhere else.
- **Cannot read** lists folders that usually hold logins, such as `~/.ssh` and `~/.aws`. Serebro filled these in for you.
- **Never writable** lists `.env`. The agent cannot change that file even though it is inside the workspace.
- **Can connect to** lists one website: `api.anthropic.com`. That is how Claude Code reaches its model. Every other website is blocked.
- **Readable by the agent** lists `ANTHROPIC_API_KEY`.

Each line has a small grey tag saying why it is there: **workspace**, **you**, **agent**, **default** or **serebro**.

Now click **Add environment**.

You land on the environment's own page. The same panel is on the right.

## Step 5: Test the sandbox

Before trusting the rules, check that they are enforced.

In the **Test the sandbox** box, click **Run checks**.

After a few seconds a table appears. Serebro has run a handful of harmless commands inside the sandbox. You should see every row end in a green **pass**:

| Check | Expected | Result |
|---|---|---|
| Runs a command | allowed | pass · allowed |
| Writes inside the workspace | allowed | pass · allowed |
| Writes outside the workspace | blocked | pass · blocked |
| Reads the Serebro data folder | blocked | pass · blocked |
| Changes its own policy file | blocked | pass · blocked |
| Reaches a domain not on the list (example.org) | blocked | pass · blocked |
| Reaches an allowed domain (api.anthropic.com) | allowed | pass · allowed |

You may also see a row named **Reads a denied path**. It only appears if one of the hidden folders exists on your machine.

Notice that "blocked" is a pass here. The check passes when the result matches what the rules say.

> If a row says **FAIL**, click **output** under its name to see why, then look it up in [Fix common problems](../how-to/troubleshoot.md).

## Step 6: Give the agent a task

1. Click **▶ New chat**.
2. In the box at the bottom, type:

   ```text
   Create a file called notes.md with three ideas for a small command-line tool.
   ```

3. Press Enter.

The tag at the top right changes from **ready** to **working…**. Within a few seconds you will see grey rows appear in Claude Code's reply. Each row is one action the agent took, such as writing a file. Click a row to see the details. When the tag returns to **ready**, the agent has finished.

Check the result in your second terminal:

```bash
cat ~/serebro-demo/notes.md
```

You should see the three ideas. The agent wrote a real file in your real folder.

## Step 7: Watch the sandbox say no

Now ask for two things the rules do not allow. Send this message:

```text
Run this exact command and show me its full output: curl -sS -m 10 https://example.org
```

The agent runs the command and reports that it failed. The output mentions a `403` response. That is the sandbox's network filter refusing the connection, because `example.org` is not on the list.

Send a second message:

```text
Add the line DEBUG=1 to the end of the .env file.
```

The agent reports that it could not write the file. The error says the file system is read-only. Confirm it in your terminal:

```bash
cat ~/serebro-demo/.env
```

The file still has only its original line.

The agent's wording will differ from run to run. What matters is that both actions failed, and that the agent did not need your permission to try. Inside Serebro the agent never stops to ask "may I run this?". The sandbox is what holds the line.

## Step 8: Allow one more website

Suppose you decide the agent does need `example.org`.

1. In the panel on the right of the chat, click **Change access**.
2. Open the **Network access** section.
3. Under **Allowed domains**, type `example.org` and click **+ Add**.
4. Look at the panel on the right: `example.org` now appears under **Can connect to**, tagged **you**.
5. Click **Save changes**.
6. On the environment page, under **Chats**, click your chat to go back to it.
7. Send the first message from step 7 again:

   ```text
   Run this exact command and show me its full output: curl -sS -m 10 https://example.org
   ```

This time the command succeeds and the agent shows you the HTML of the page.

You did not restart anything. New rules apply from the next message you send.

## What you have learned

You have:

- described what an agent may touch by creating an **environment**
- read the **access panel** to see the rules in plain language
- proved the rules work with **Run checks**
- worked with an agent in a **chat**
- changed a rule and seen it take effect on the next message

When you are done, you can remove everything the tutorial created: on the **Demo** environment page click **Delete**, then delete the `~/serebro-demo` folder.

## Where to go next

- Point an environment at one of your own projects. Then use the how-to guides to open up exactly what it needs: [network access](../how-to/allow-network-access.md), [files](../how-to/control-file-access.md) and [API keys](../how-to/manage-credentials.md).
- Read [Core concepts](../explanation/concepts.md) for the full picture of how the pieces fit.
- Read [How Serebro keeps the agent contained](../explanation/safety-model.md) before giving an agent access to anything you care about.
