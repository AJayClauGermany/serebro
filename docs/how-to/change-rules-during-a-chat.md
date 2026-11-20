# Change the rules during a chat

You do not need to start a new chat to change what the agent can touch. Every message you send starts the agent in a fresh sandbox built from the current rules, and the agent picks up the conversation where it left off.

## Change a rule and carry on

1. In the chat, click **Change access** under the panel on the right.
2. Make the change and click **Save changes**.
3. On the environment page, find your chat under **Chats** and click it.
4. Send your next message. It runs under the new rules.

## Keep the chat open while you edit

If you would rather not leave the chat:

1. Open the environment in a second browser tab. (The **Edit policy file ↗** button in the chat opens the environment page in a new tab.)
2. Make and save the change there.
3. Switch back to the chat tab. Within a few seconds a bar appears: **Sandbox policy changed. It applies to your next message.**
4. Send your next message, or click **↻ Reload sandbox** to refresh the panel first.

## Apply new rules to a task that is already running

A running task keeps the rules it started with. To move it onto the new rules:

1. Make and save the change in a second tab.
2. In the chat tab, click **■ Stop & reload sandbox** in the bar.
3. Send a message asking the agent to continue.

Use the same button when you have just tightened a rule and want the running task cut off straight away.

## If the bar says the new policy is invalid

The change you saved would stop the sandbox from starting. Your next message will fail until it is fixed. Open the environment page: the panel shows the reason in a red box. See [Fix common problems](troubleshoot.md).
