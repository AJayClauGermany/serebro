# Core concepts

Serebro has five ideas. This page explains each one and how they connect. If you have used a coding agent before, most of this will be familiar. The part that is different is where the safety comes from.

## The one-sentence version

You write down what an agent is allowed to touch (an **environment**), Serebro has a **sandbox** enforce it, and you talk to the **agent** in a **chat** while it works in your **workspace**.

```
            ┌───────────────────── Environment ─────────────────────┐
            │  workspace + agent + file rules + network rules + keys │
            └───────────────────────────┬───────────────────────────┘
                                        │ enforced by
                                        ▼
You ── chat ──► Serebro ──► ┌─────────── Sandbox ───────────┐
                            │  Agent (Claude Code, Codex…)  │──► allowed websites only
                            │  works in the workspace       │──► allowed files only
                            └───────────────────────────────┘
```

## Agent

An agent is a program that takes an instruction in plain language and carries it out by reading files, editing them and running commands. Claude Code and Codex are agents. You may also know them as coding harnesses.

Serebro does not contain an agent of its own. It runs the ones you have installed, and gives them all the same controls and the same chat window. The list is in [Supported agents](../reference/agents.md).

## Workspace

The workspace is one folder on your machine: the project the agent works on. The agent starts there and can read and change anything in it.

It is your real folder, not a copy. When the agent edits a file, the file on your disk changes, and you can open it in your editor straight away. This is what makes the agent useful, and it is also why the rest of the rules matter. If you want a safety net for the workspace itself, use version control: commit before a big task, and review the diff after.

## Sandbox

A sandbox is a fence the operating system puts around a program. A program inside it can only open the files and reach the websites the fence allows. The program cannot switch the fence off, because the fence is not part of the program.

Serebro starts the agent inside a sandbox, so every command the agent runs is inside it too. If the agent runs `curl`, `npm`, a script it just wrote, or a tool it downloaded, the same fence applies.

Serebro uses existing sandboxes and does not implement one itself: [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) by default, and [nono](https://nono.sh) where that cannot run. For getting started you do not need to know how either works. The differences are in [Sandboxes compared](../reference/sandboxes.md).

## Environment

An environment is the thing you actually create and edit. It is a saved answer to five questions:

1. **Where** does the agent work? (the workspace)
2. **Which** agent, and which model?
3. **Which files** beyond the workspace can it write, and which can it not read?
4. **Which websites** can it reach?
5. **Which keys** does it get?

A new environment starts closed: the agent can write only in the workspace, reach only its own model, and gets no keys except the ones you add. You open things up as the work needs them.

You can have several environments for the same project. For example, a strict one for exploring unfamiliar code, and a looser one with package installs allowed for routine work. They are cheap to make.

### The access panel

Serebro turns each environment into two things at once: the settings it gives the sandbox, and a plain-language summary called the access panel (**What the agent can touch**). Both are produced together from the same data, so the panel cannot say one thing while the sandbox does another.

Reading the panel is the quickest way to answer "what could this agent do right now?". Its labels are explained in [The access panel and sandbox checks](../reference/access-panel.md).

### Checks

An environment also has a test button, **Run checks**. It runs harmless commands inside the sandbox to show that allowed things work and blocked things fail. The panel tells you what the rules are. The checks show you the rules are being enforced on this machine.

## Chat

A chat is a conversation with the agent inside one environment. You describe a task, and the agent works and reports back. You can see each action it takes.

Two things about chats are worth knowing early:

- **The rules are read fresh for every message.** Each message starts the agent in a new sandbox built from the environment as it is at that moment. So you can change the environment in the middle of a conversation, and your next message runs under the new rules. The agent keeps its memory of the conversation across this.
- **The agent does not ask before acting.** On your own machine, an agent normally stops and asks before it runs a command. In Serebro those prompts are off. See the next section for why.

## Where the safety comes from

Without a sandbox, an agent is kept safe by asking: "May I run `rm -rf build`?" That puts you in the loop for every step, and it only works as long as you read every prompt carefully.

Serebro moves the decision. You decide once, in advance, what the agent can reach. Inside that boundary it works without interruption. Outside it, things simply fail, whatever the agent was told or tricked into trying.

This changes what you need to pay attention to. You no longer review each command. You review the environment. The useful question is no longer "is this command safe?" but "if this agent did the worst thing possible with what I have given it, what would that be?" The access panel is built to help you answer that.

[How Serebro keeps the agent contained](safety-model.md) goes through that question in detail.

## How the concepts map to the screens

| Concept | Where you see it |
|---|---|
| Environment | A card on the home page. Its own page. The **New** and **Edit** forms. |
| Workspace, agent, rules, keys | Fields on the environment form. |
| Sandbox | The **Sandbox** field, and **Enforced by** at the top of the access panel. |
| Access panel | Right side of the form, the environment page and every chat. |
| Checks | **Test the sandbox** on the environment page. |
| Chat | **▶ New chat** on an environment. **Recent chats** on the home page. |
