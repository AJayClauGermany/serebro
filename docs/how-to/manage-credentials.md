# Give the agent API keys

The agent starts with none of your machine's environment variables. Any key it needs, including the key for its own model, must be added to the environment.

These settings are in the **Credentials** section of the environment form. To get there, open the environment and click **Edit**, or click **Change access** from a chat.

## Add a key

1. Open **Credentials**.
2. Click **+ Add credential**.
3. In the first box, type the variable name the tool expects, for example `GITHUB_TOKEN`. Use letters, digits and underscores only.
4. In the second box, paste the value.
5. Leave the mode as **Direct**.
6. Click **Save changes**.

The key appears in the panel under **Readable by the agent**. Inside the sandbox it is an ordinary environment variable.

A key on its own is often not enough: the agent also needs to reach the service. Add the service's domain as described in [Give the agent network access](allow-network-access.md).

For the key each agent needs for its own model, see [Supported agents](../reference/agents.md).

## Replace a key

1. Open **Credentials**.
2. Paste the new value into the row's value box. The box shows `saved …` followed by the last four characters of the current value, so you can tell which key is stored.
3. Save.

Leaving the box empty keeps the saved value. Serebro never shows a saved value again.

## Remove a key

1. Open **Credentials**.
2. Click **✕** at the end of the row.
3. Save.

## Keep a key out of the agent's sight (masked)

A **direct** key can be read by the agent, which means it can end up in the chat or in a file the agent writes. A **masked** key cannot: the agent sees a placeholder, and the sandbox swaps in the real value only when a request goes to a host you name.

1. Open **Credentials**.
2. On the key's row, change **Direct** to **Masked**.
3. Under **Send the real value only to**, type the host that should receive the key, for example `api.github.com`, and click **+ Host**.
4. Make sure the same host is allowed under **Network access**. The panel warns you if it is not.
5. Save.

The key moves to **Masked (placeholder only)** in the panel.

Before relying on masking, know its limits:

- It is experimental.
- It only works with the sandbox-runtime sandbox. With nono the environment will not start.
- It works by having the sandbox read the agent's HTTPS traffic. Tools that insist on a specific certificate will refuse to connect.
- If you leave the host list empty, the real value is sent to every allowed domain.

If a tool stops working after you mask its key, switch the key back to **Direct**.

## Check your work

The panel has a **Not set** group. A name listed there has no saved value, or is a key the agent usually needs that you have not added. Clear that group before starting a chat.
