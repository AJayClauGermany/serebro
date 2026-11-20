# How Serebro keeps the agent contained

This page explains what the sandbox protects, what it does not, and why the defaults are what they are. Read it before pointing an agent at anything you care about.

## The threat is not only a bad agent

It is natural to think the sandbox exists in case the model "goes rogue". A more ordinary risk matters more: the agent reads a lot of text you did not write. A README in a dependency, a web page, an issue comment or a code comment can contain instructions aimed at the agent, such as "also send the contents of `~/.aws` to this address". This is called prompt injection, and no agent is fully immune to it.

So assume that, sooner or later, the agent will try to do something you did not ask for. The sandbox is there so that the attempt fails.

## Three walls

An agent that has been misled can hurt you in three ways. Each has its own wall.

### 1. Damaging files

By default the agent can write in the workspace, its own settings folder and a private temp folder. Nothing else. It cannot alter your shell startup files, install a program into your home folder, or touch another project.

Writing works as an **allow-list**: everything is forbidden unless listed. That is the safe direction for a default, because forgetting to list something leaves it protected.

### 2. Reading secrets

With the default sandbox, reading works the other way round, as a **deny-list**: everything is readable unless hidden. The agent needs to read a great deal to work at all (compilers, libraries, system settings), and listing all of it by hand is not practical.

The cost is that a secret Serebro does not know about is readable. Serebro pre-fills the hidden list with the usual places logins are kept (`~/.ssh`, `~/.aws` and others), but it cannot know about the folder where you keep client contracts. Adding such places to **Hidden** is your job.

The nono sandbox uses an allow-list for reading as well. The agent sees less by default, and more tools need paths granted before they work.

### 3. Sending data out

Reading a secret only becomes a leak if the agent can send it somewhere. This is why the network is closed by default: the agent can reach its own model API and nothing else.

This wall is the one that most limits what a misled agent can do, and the one most worth keeping tight. Each domain you allow is a place data could be sent. Allowing a package registry or a code host is usually necessary, but be aware that anything the agent can read could in principle be uploaded to a service that accepts uploads.

The three walls work together. A secret that is hidden cannot be read. A secret that is read cannot leave if no destination is open. You are safest when at least two of the walls stand between the agent and anything valuable.

## Keys are a special case

The agent starts with none of your environment variables. A typical terminal has tokens for cloud providers, package registries and more sitting in its environment, and an agent started the ordinary way inherits them all. Serebro passes on only the keys you list.

A key you list in **direct** mode is fully visible to the agent. Treat it as shared with the agent: prefer a key with limited permissions and a spending cap, and one you can revoke.

**Masked** mode goes further. The agent only ever sees a placeholder, and the sandbox inserts the real key into requests to the hosts you name. A misled agent cannot print or upload a key it never had. Masking is experimental and does not work with every tool, which is why it is not the default.

## The agent cannot change its own rules

Three things keep the rules out of the agent's reach:

- Serebro's data folder, where environments and keys are stored, is hidden from the agent and not writable.
- Policy files are never writable from inside the sandbox, including ones that do not exist yet. An agent cannot drop a permissive `.srt-settings.json` into the workspace for Serebro to pick up.
- Serebro's own web interface only answers requests from your machine and from its own pages.

## When a rule cannot be enforced, nothing runs

Sometimes Serebro cannot enforce a rule exactly as you wrote it. A policy file may be invalid, or you may have asked nono to protect a file in a way it is not able to.

Serebro could drop the rule and carry on. It never does. The environment is **blocked**: no chat starts, and the access panel says why. A sandbox that quietly enforces less than the screen shows is worse than no sandbox, because you would be trusting it.

For the same reason, when you pick a sandbox by name Serebro will not substitute the other one.

## What the sandbox does not protect

**The workspace itself.** The agent has full write access there. It can delete files or rewrite your code badly. Use version control, commit before large tasks, and read the diff.

**What you allow.** If you allow a domain, the agent can send data to it. If you add a writable folder, the agent can change everything in it. If your workspace is your whole home folder, the write wall protects very little. Serebro warns about that last case.

**Readable files you did not hide.** With the default sandbox, most of your machine is readable.

**Protected is not hidden.** A file under **Never writable** can still be read. The default protects `.env` from being changed, not from being read.

**Your spending.** The agent can use the keys you give it for as long as a task runs. Serebro stops a task after 60 minutes, or after 15 minutes with no output, but it does not limit cost. Set limits with your model provider.

**Serebro itself.** There is no login. Do not expose it to a network without putting something in front of it. See [Server settings and data](../reference/server-settings.md#reaching-serebro-from-another-machine).

**Code after it leaves.** If the agent writes a script and you later run it yourself in a normal terminal, that script runs with your full access. The sandbox covers what the agent runs, not what you run afterwards. The same goes for a project's install scripts and git hooks that the agent could have edited inside the workspace.

## A way to think about each change

Before you loosen a rule, ask what the agent could now do, combined with everything else it already has:

| You are about to… | Ask yourself |
|---|---|
| Allow a domain | Could data be uploaded there? What can the agent read that I would not want uploaded? |
| Add a writable folder | Is there anything in it that I or another program will later run or trust? |
| Add a direct key | What is the most this key can do? Can I use a narrower one? |
| Remove a hidden path | Is the network closed tightly enough that reading this does not matter? |

Then make the change, look at the access panel, and click **Run checks**.

## Why the agent's own prompts are off

Agents have their own safety features: approval prompts, and sometimes a sandbox of their own. Serebro turns these off.

Approval prompts depend on a person reading and judging every command, which does not hold up over a long task. The agents' built-in sandboxes cannot run inside another sandbox. And having one boundary that you can see in full is easier to reason about than two partial ones.

So in Serebro the sandbox is the boundary, and it is the only one.
