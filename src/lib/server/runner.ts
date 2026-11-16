// Starts agent runs and sandbox self-tests for an environment.

import { execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chat, type StreamChunk } from '@tanstack/ai';
import { defineSandbox, withSandbox } from '@tanstack/ai-sandbox';
import { Cause, Context, Duration, Effect, Stream } from 'effect';
import type { ProbeResult, SessionView } from '#lib/types.ts';
import { DATA_DIR, serverConfig } from './config.ts';
import { getHarness } from './harnesses.ts';
import { AgentFailed, AgentTimedOut, SandboxBlocked } from './errors.ts';
import { prepareSandbox } from './policy.ts';
import { projectPolicyPath, workspacePath } from './policy-file.ts';
import type { StoredEnvironment } from './schemas.ts';
import { Store } from './store.ts';
import { shellQuote, wrapCommand } from './sandbox-backends.ts';
import { localSandbox, proxyEnv } from './sandbox-provider.ts';

/**
 * Prepare the sandbox and start one agent turn. Setup problems (an invalid policy file, an
 * unwritable data folder) fail the Effect before anything starts; the caller reports them.
 */
export const runAgent = Effect.fn('runAgent')(function* (opts: {
	env: StoredEnvironment;
	session: SessionView;
	messages: Parameters<typeof chat>[0]['messages'];
	signal: AbortSignal;
}) {
	const { env, session, messages, signal } = opts;
	const store = yield* Store;
	const harness = getHarness(session.harness);
	const { compiled, settingsFile, stateDir } = yield* prepareSandbox(env);
	yield* Effect.annotateCurrentSpan({ environment: env.id, session: session.id, harness: harness.id });

	const sandbox = defineSandbox({
		id: `serebro-${env.id}`,
		provider: localSandbox({
			backend: compiled.backend,
			workspace: workspacePath(env),
			settingsFile,
			stateDir,
			env: compiled.env
		}),
		lifecycle: { reuse: 'thread', destroyOnComplete: false },
		fileEvents: false
	});

	// The agent gets its own controller: stopping it on a timeout must not also abort the
	// HTTP response, or the RUN_ERROR explaining why would never reach the browser.
	const agentAbort = abortFrom(signal);
	const stream = chat({
		adapter: harness.createAdapter(session.model),
		threadId: session.id,
		messages,
		abortController: agentAbort,
		middleware: [withSandbox(sandbox)],
		modelOptions: session.agentSessionId ? { sessionId: session.agentSessionId } : {}
	} as never) as AsyncIterable<StreamChunk>;

	return superviseAgentStream(stream, {
		// Run the stream with this request's services, so its logs and spans go where ours do.
		context: yield* Effect.context(),
		turnTimeout: serverConfig.turnTimeout,
		idleTimeout: serverConfig.idleTimeout,
		stop: () => agentAbort.abort(),
		attributes: { environment: env.id, session: session.id, harness: harness.id },
		onChunk: (chunk) => {
			const c = chunk as { type: string; name?: string; value?: { sessionId?: string } };
			if (c.type !== 'CUSTOM' || c.name !== harness.sessionEvent || !c.value?.sessionId) return Effect.void;
			// Remember the harness's own session id so the next turn resumes the agent's context.
			// Best effort: a failure is logged and must not cut off the agent's reply.
			return store.patchSession(session.id, { agentSessionId: c.value.sessionId }).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning('Could not save the agent session id; the next turn starts fresh', Cause.pretty(cause))
				)
			);
		}
	});
});

const runError = (message: string) => ({ type: 'RUN_ERROR', timestamp: Date.now(), message }) as unknown as StreamChunk;

/**
 * Wrap an agent's event stream with the turn limits and error handling:
 * - no event for `idleTimeout`, or the turn running past `turnTimeout`, stops the agent;
 * - an exception from the agent stream is logged with its cause;
 * in both cases the browser receives one RUN_ERROR event saying what happened.
 */
export function superviseAgentStream(
	source: AsyncIterable<StreamChunk>,
	opts: {
		turnTimeout: Duration.Duration;
		idleTimeout: Duration.Duration;
		/** Stop the agent process. */
		stop: () => void;
		onChunk?: (chunk: StreamChunk) => Effect.Effect<void>;
		attributes?: Record<string, string>;
		context?: Context.Context<never>;
	}
): AsyncIterable<StreamChunk> {
	const timedOut = (limit: 'turn' | 'idle', after: Duration.Duration) =>
		new AgentTimedOut({ limit, after: Duration.format(after) });
	return Stream.fromAsyncIterable(source, (cause) => new AgentFailed({ cause })).pipe(
		Stream.tap((chunk) => opts.onChunk?.(chunk) ?? Effect.void),
		Stream.timeoutOrElse({
			duration: opts.idleTimeout,
			orElse: () => Stream.fail(timedOut('idle', opts.idleTimeout))
		}),
		Stream.interruptWhen(Effect.sleep(opts.turnTimeout).pipe(Effect.andThen(Effect.fail(timedOut('turn', opts.turnTimeout))))),
		Stream.catch((e) =>
			Stream.fromEffect(
				Effect.sync(opts.stop).pipe(
					Effect.andThen(
						e._tag === 'AgentTimedOut'
							? Effect.logWarning(e.message)
							: Effect.logError('The agent stream failed', Cause.pretty(Cause.fail(e.cause)))
					),
					Effect.as(runError(e.message))
				)
			)
		),
		Stream.withSpan('agent.turn', { attributes: opts.attributes }),
		Stream.toAsyncIterableWith(opts.context ?? Context.empty())
	);
}

function abortFrom(signal: AbortSignal) {
	const ac = new AbortController();
	if (signal.aborted) ac.abort();
	else signal.addEventListener('abort', () => ac.abort(), { once: true });
	return ac;
}

/** Run a shell command. Never fails: a non-zero exit, a timeout or a spawn error is a result. */
const run = (command: string, cwd: string, env: Record<string, string>, timeout = Duration.seconds(20)) =>
	Effect.callback<{ code: number; out: string }>((resume, signal) => {
		execFile(
			'/bin/sh',
			['-c', command],
			{
				cwd,
				signal,
				timeout: Duration.toMillis(timeout),
				env: { PATH: process.env.PATH ?? '', HOME: os.homedir(), ...proxyEnv(), ...env }
			},
			(err, stdout, stderr) => {
				const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
				resume(Effect.succeed({ code, out: `${stdout}${stderr}`.trim().slice(-2000) }));
			}
		);
	});

const failed = (name: string, output: string): ProbeResult[] => [
	{ name, command: '', expect: 'allowed', outcome: 'blocked', pass: false, output }
];

/**
 * Run a few harmless commands inside the sandbox and check that each is allowed or
 * blocked as the policy says. This is the "does it actually work?" button.
 */
export const probeEnvironment = Effect.fn('probeEnvironment')(function* (env: StoredEnvironment) {
	const prepared = yield* prepareSandbox(env).pipe(Effect.catchTag('SandboxBlocked', Effect.succeed));
	if (prepared instanceof SandboxBlocked) return failed('Sandbox can start', prepared.message);
	const { compiled, settingsFile, stateDir } = prepared;
	const cwd = workspacePath(env);
	if (!fs.existsSync(cwd)) return failed('Workspace exists', `Missing: ${cwd}`);

	const marker = `.serebro-probe-${Date.now()}`;
	const outside = path.join(os.homedir(), marker);
	const firstDenied = compiled.report.filesystem.denyRead.find(
		(d) => d.source !== 'runtime' && hasContent(d.value.replace(/^~(?=$|\/)/, os.homedir()))
	)?.value;
	const allowed = compiled.report.network.allowed.filter((d) => !d.value.includes('*'));
	const firstAllowed = (allowed.find((d) => d.source === 'agent') ?? allowed[0])?.value;
	const blockedHost = ['example.org', 'neverssl.com', 'wikipedia.org'].find(
		(h) => !compiled.report.network.allowed.some((a) => a.value === h || a.value === '*')
	);

	const probes: Array<{ name: string; command: string; expect: 'allowed' | 'blocked' }> = [
		{ name: 'Runs a command', command: 'echo sandbox-ok', expect: 'allowed' },
		{ name: 'Writes inside the workspace', command: `touch ${marker} && rm ${marker}`, expect: 'allowed' },
		{ name: 'Writes outside the workspace', command: `touch ${outside}`, expect: 'blocked' },
		{ name: 'Reads the Serebro data folder', command: canSee(DATA_DIR), expect: 'blocked' },
		// Only sandbox-runtime reads policy files; with nono there is no such file to protect.
		...(compiled.backend === 'srt'
			? [{ name: 'Changes its own policy file', command: `touch ${shellQuote(projectPolicyPath(env))}`, expect: 'blocked' as const }]
			: []),
		...(firstDenied
			? [{ name: `Reads a denied path (${firstDenied})`, command: canSee(firstDenied.replace(/^~(?=$|\/)/, os.homedir())), expect: 'blocked' as const }]
			: []),
		...(blockedHost
			? [{ name: `Reaches a domain not on the list (${blockedHost})`, command: `curl -sS -m 8 -o /dev/null https://${blockedHost}`, expect: 'blocked' as const }]
			: []),
		...(firstAllowed
			? [{ name: `Reaches an allowed domain (${firstAllowed})`, command: `curl -sS -m 8 -o /dev/null https://${firstAllowed}`, expect: 'allowed' as const }]
			: [])
	];

	// A stand-in for any service on this machine's localhost (Serebro's own API is one). nono
	// shares the machine's network unless told otherwise, so check the agent cannot reach it.
	// (srt differs by platform here, so its behaviour is left as it was.)
	const local = compiled.backend === 'nono' ? yield* listenOnLoopback : null;
	if (local) {
		const port = (local.address() as net.AddressInfo).port;
		probes.push({
			name: "Reaches a service on this machine's localhost",
			command: `curl -sS -m 5 --noproxy '*' -o /dev/null http://127.0.0.1:${port}/`,
			expect: 'blocked'
		});
	}

	return yield* Effect.forEach(probes, (p) =>
		run(wrapCommand({ backend: compiled.backend, settingsFile, stateDir }, p.command), cwd, compiled.env).pipe(
			Effect.map((r): ProbeResult => {
				const outcome = r.code === 0 ? 'allowed' : 'blocked';
				return { ...p, outcome, pass: outcome === p.expect, output: redact(r.out, compiled.env) };
			})
		)
	).pipe(
		// Remove the marker even if the probe is interrupted (the browser went away).
		Effect.ensuring(
			Effect.sync(() => {
				fs.rmSync(outside, { force: true });
				local?.close();
			})
		)
	);
});

/** A throwaway HTTP-ish listener on 127.0.0.1, on a port the system picks. */
const listenOnLoopback = Effect.callback<net.Server>((resume) => {
	const server = net.createServer((socket) => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
	server.listen(0, '127.0.0.1', () => resume(Effect.succeed(server)));
});

/** Exit 0 only if the path's content is visible (a denied folder shows up empty). */
function canSee(p: string) {
	const q = shellQuote(p);
	return `if [ -d ${q} ]; then test -n "$(ls -A ${q})"; else head -c1 ${q} | grep -q .; fi`;
}

function hasContent(p: string) {
	try {
		const st = fs.statSync(p);
		return st.isDirectory() ? fs.readdirSync(p).length > 0 : st.size > 0;
	} catch {
		return false;
	}
}

function redact(text: string, env: Record<string, string>) {
	let out = text;
	for (const v of Object.values(env)) if (v.length >= 8) out = out.split(v).join('••••');
	return out;
}
