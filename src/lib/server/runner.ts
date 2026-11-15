// Starts agent runs and sandbox self-tests for an environment.

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chat, type StreamChunk } from '@tanstack/ai';
import { defineSandbox, withSandbox } from '@tanstack/ai-sandbox';
import type { ProbeResult } from '#lib/types.ts';
import { getHarness } from './harnesses';
import { compilePolicy, writeSettings } from './policy';
import { projectPolicyPath } from './policy-file.ts';
import { DATA_DIR, patchSession, type StoredEnvironment } from './store';
import { proxyEnv, shellQuote, srtSandbox, wrapCommand } from './srt-provider';
import type { SessionView } from '#lib/types.ts';

function resolveWorkspace(env: StoredEnvironment) {
	const w = env.workspace.startsWith('~/') ? path.join(os.homedir(), env.workspace.slice(2)) : env.workspace;
	return path.resolve(w);
}

export function runAgent(opts: {
	env: StoredEnvironment;
	session: SessionView;
	messages: Parameters<typeof chat>[0]['messages'];
	signal: AbortSignal;
}): AsyncIterable<StreamChunk> {
	const { env, session, messages, signal } = opts;
	const harness = getHarness(session.harness);
	const compiled = compilePolicy(env);
	if (compiled.report.blocked) throw new Error(compiled.report.blocked);
	const settingsFile = writeSettings(env, compiled);

	const sandbox = defineSandbox({
		id: `serebro-${env.id}`,
		provider: srtSandbox({
			workspace: resolveWorkspace(env),
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
	return (async function* () {
		for await (const chunk of stream) {
			const c = chunk as { type: string; name?: string; value?: { sessionId?: string } };
			if (c.type === 'CUSTOM' && c.name === harness.sessionEvent && c.value?.sessionId) {
				patchSession(session.id, { agentSessionId: c.value.sessionId });
			}
			yield chunk;
		}
	})();
}

function abortFrom(signal: AbortSignal) {
	const ac = new AbortController();
	if (signal.aborted) ac.abort();
	else signal.addEventListener('abort', () => ac.abort(), { once: true });
	return ac;
}

function run(command: string, cwd: string, env: Record<string, string>, timeoutMs = 20_000) {
	return new Promise<{ code: number; out: string }>((resolve) => {
		execFile(
			'/bin/sh',
			['-c', command],
			{ cwd, timeout: timeoutMs, env: { PATH: process.env.PATH ?? '', HOME: os.homedir(), ...proxyEnv(), ...env } },
			(err, stdout, stderr) => {
				const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
				resolve({ code, out: `${stdout}${stderr}`.trim().slice(-2000) });
			}
		);
	});
}

/**
 * Run a few harmless commands inside the sandbox and check that each is allowed or
 * blocked as the policy says. This is the "does it actually work?" button.
 */
export async function probeEnvironment(env: StoredEnvironment): Promise<ProbeResult[]> {
	const compiled = compilePolicy(env);
	if (compiled.report.blocked) {
		return [{ name: 'Policy file is valid', command: '', expect: 'allowed', outcome: 'blocked', pass: false, output: compiled.report.blocked }];
	}
	const settingsFile = writeSettings(env, compiled);
	const cwd = resolveWorkspace(env);
	if (!fs.existsSync(cwd)) {
		return [{ name: 'Workspace exists', command: '', expect: 'allowed', outcome: 'blocked', pass: false, output: `Missing: ${cwd}` }];
	}
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

	const results: ProbeResult[] = [];
	for (const p of probes) {
		const r = await run(wrapCommand(settingsFile, p.command), cwd, compiled.env);
		const outcome = r.code === 0 ? 'allowed' : 'blocked';
		results.push({ ...p, outcome, pass: outcome === p.expect, output: redact(r.out, compiled.env) });
	}
	fs.rmSync(outside, { force: true });
	return results;
}

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
