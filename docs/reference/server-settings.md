# Server settings and data

## Starting Serebro

| Command | Use |
|---|---|
| `pnpm dev` | Development server on <http://localhost:5173>. |
| `pnpm build`, then `node build` | Production build and server. |

## Environment variables

Set these in the terminal before starting Serebro. A value Serebro cannot understand stops the server at startup with a message.

| Variable | Default | Meaning |
|---|---|---|
| `SEREBRO_DATA_DIR` | `./.serebro` in the folder you start Serebro from | Where Serebro keeps environments, keys and chats. |
| `SEREBRO_TURN_TIMEOUT` | `60 minutes` | The longest one agent task may run. Write a duration such as `90 minutes`. `Infinity` turns the limit off. |
| `SEREBRO_IDLE_TIMEOUT` | `15 minutes` | How long the agent may go without producing output before it is stopped. Same format. |
| `SEREBRO_NONO_BIN` | Found on `PATH` | Full path to the `nono` program. |
| `SEREBRO_SRT_BIN` | The bundled copy | Full path to a different sandbox-runtime program. |
| `SEREBRO_ALLOWED_HOSTS` | none | Extra host names Serebro answers to, separated by commas. |
| `SEREBRO_ALLOW_REMOTE` | off | Set to `1` to accept connections from other machines. |
| `HTTPS_PROXY`, `HTTP_PROXY` | none | Your network's proxy. The sandbox sends allowed traffic through it. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | none | Send traces and logs to an OpenTelemetry collector. |

Example:

```bash
SEREBRO_TURN_TIMEOUT="2 hours" SEREBRO_DATA_DIR=~/.serebro pnpm dev
```

## Reaching Serebro from another machine

Serebro has no login. Anyone who can reach it can run agents on your machine. So by default it only answers requests that:

- come from the same machine
- are addressed to `localhost`, `127.0.0.1` or `::1`
- come from Serebro's own pages

To use it from elsewhere, put it behind a proxy that handles login, then set both:

```bash
SEREBRO_ALLOWED_HOSTS=serebro.example.com SEREBRO_ALLOW_REMOTE=1 node build
```

Do not set these without such a proxy in front.

## Where data is kept

Everything is in the data folder. The **System** box on the home page shows its location.

| Path | Contents |
|---|---|
| `environments.json` | Environment settings. No key values. |
| `secrets.json` | Key values. Readable only by your user account. |
| `sessions.json` | The list of chats. |
| `messages/` | Chat transcripts. |
| `sandboxes/<environment id>/` | The settings file generated for the sandbox before each run. |

The agent can never read or write the data folder.

Outside the data folder, Serebro creates a private temp folder for each environment at `~/.cache/serebro/tmp/<environment id>`.

To back up or move Serebro, copy the data folder. Treat `secrets.json` like a password file.

## Limits

- A task is stopped when it reaches `SEREBRO_TURN_TIMEOUT` or `SEREBRO_IDLE_TIMEOUT`. The chat says which.
- Serebro checks the policy file and rebuilds the sandbox settings before every message.
