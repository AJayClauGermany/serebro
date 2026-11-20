# Give the agent network access

By default the agent can reach one place: its own model API. Everything else is blocked. This guide shows how to open up what a task needs.

All of these settings are in the **Network access** section of the environment form. To get there, open the environment and click **Edit**, or click **Change access** from a chat.

After each change, check the **Can connect to** list in the panel on the right, then click **Save changes**. The new rules apply from the next message you send.

## Let the agent install packages

Use this when the agent needs `npm install`, `pip install`, `cargo build`, `go get` or `git clone` from GitHub.

1. Open **Network access**.
2. Tick **Allow package managers (npm, PyPI, crates.io, Go, GitHub)**.
3. Save.

The domains this adds appear in the panel tagged **packages**. The full list is in the [environment settings reference](../reference/environment-settings.md#network-access).

If your project uses a registry that is not on that list (a company registry, a different language's registry), add its domain by hand as described next.

## Allow a specific website or API

1. Open **Network access**.
2. Under **Allowed domains**, type the domain and click **+ Add**. Type only the domain, such as `api.example.com`, with no `https://` and no path.
3. Save.

To allow every subdomain, use a wildcard: `*.example.com`. A wildcard does not cover the bare domain, so add `example.com` as well if you need both.

You can paste several domains at once, separated by spaces or commas.

### Find out which domain is being blocked

If a command fails and you do not know which domain it wanted:

1. In the chat, click the failed action to open its output.
2. Look for the host name in the error. Blocked requests usually show a `403` from the proxy, or a "could not resolve" or "connection refused" message that names the host.
3. Add that domain and send the message again.

Some tools need more than one domain (a download often redirects to a second host). Repeat until the command works.

## Block part of an allowed wildcard

1. Open **Network access**.
2. Under **Always blocked**, type the domain and click **+ Block**.
3. Save.

A blocked domain stays blocked even if an allowed wildcard matches it. For example, allow `*.example.com` and block `tracker.example.com`.

## Let the agent run a dev server

Use this when the agent needs to start something that listens on a port, such as `npm run dev` or a test server.

1. Open **Network access**.
2. Tick **Allow local ports (for dev servers)**.
3. Save.

The panel then shows **Local ports: allowed**.

The server runs inside the sandbox. The agent can call it (for example with `curl localhost:3000`), but on Linux you cannot open it from your own browser, because the sandbox has a network of its own.

With the nono sandbox this setting only works on Linux. See [Sandboxes compared](../reference/sandboxes.md).

## Cut the agent off from its model API

You will rarely want this, because the agent cannot work without its model. It is useful when you route the agent through a gateway of your own.

1. Open **Network access**.
2. Untick **Allow <agent>'s model API**.
3. Add your gateway's domain under **Allowed domains**.
4. Save.

The panel warns you that the agent's usual domain is off.

## Check your work

Open the environment page and click **Run checks**. The last rows test one domain that should be blocked and one that should be allowed. See [The access panel and sandbox checks](../reference/access-panel.md#sandbox-checks).
