// Starts agent runs and sandbox self-tests for an environment.

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chat, type StreamChunk } from '@tanstack/ai';
import { defineSandbox, withSandbox } from '@tanstack/ai-sandbox';
import { Cause, Duration, Effect } from 'effect';
import type { ProbeResult, SessionView } from '#lib/types.ts';
import { DATA_DIR } from './config.ts';
import { getHarness } from './harnesses.ts';
import { SandboxBlocked } from './errors.ts';
import { prepareSandbox } from './policy.ts';
import { projectPolicyPath, workspacePath } from './policy-file.ts';
import type { StoredEnvironment } from './schemas.ts';
import { Store } from './store.ts';
import { proxyEnv, shellQuote, srtSandbox, wrapCommand } from './srt-provider.ts';

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
	const { compiled, settingsFile } = yield* prepareSandbox(env);
	yield* Effect.annotateCurrentSpan({ environment: env.id, session: session.id, harness: harness.id });

	const sandbox = defineSandbox({
		id: `serebro-${env.id}`,
		provider: srtSandbox({
			workspace: workspacePath(env),
			settingsFile,
			env: compiled.env
		}),
		lifecycle: { reuse: 'thread', destroyOnComplete: false },
		fileEvents: false
	});

	const stream = chat({
		adapter: harness.createAdapter(session.model),
		threadId: session.id,
		messages,
		abortController: abortFrom(signal),
		middleware: [withSandbox(sandbox)],
		modelOptions: session.agentSessionId ? { sessionId: session.agentSessionId } : {}
	} as never) as AsyncIterable<StreamChunk>;

	// Remember the harness's own session id so the next turn resumes the agent's context.
	// Saving it is best effort: a failure is logged and must not cut off the agent's reply.
	const rememberAgentSession = (agentSessionId: string) =>
		Effect.runPromise(
			store.patchSession(session.id, { agentSessionId }).pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning('Could not save the agent session id; the next turn starts fresh', Cause.pretty(cause))
				)
			)
		);

	return (async function* () {
		for await (const chunk of stream) {
			const c = chunk as { type: string; name?: string; value?: { sessionId?: string } };
			if (c.type === 'CUSTOM' && c.name === harness.sessionEvent && c.value?.sessionId) {
				await rememberAgentSession(c.value.sessionId);
			}
			yield chunk;
		}
	})();
});

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
	if (prepared instanceof SandboxBlocked) return failed('Policy file is valid', prepared.message);
	const { compiled, settingsFile } = prepared;
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
		{ name: 'Changes its own policy file', command: `touch ${shellQuote(projectPolicyPath(env))}`, expect: 'blocked' },
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

	return yield* Effect.forEach(probes, (p) =>
		run(wrapCommand(settingsFile, p.command), cwd, compiled.env).pipe(
			Effect.map((r): ProbeResult => {
				const outcome = r.code === 0 ? 'allowed' : 'blocked';
				return { ...p, outcome, pass: outcome === p.expect, output: redact(r.out, compiled.env) };
			})
		)
	).pipe(
		// Remove the marker even if the probe is interrupted (the browser went away).
		Effect.ensuring(Effect.sync(() => fs.rmSync(outside, { force: true })))
	);
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
