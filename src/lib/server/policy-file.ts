// Finding, validating and editing sandbox-runtime policy files.
//
// Lookup order in "auto" mode (first match wins):
//   1. <workspace>/.srt-settings.json   project policy, committed with the code
//   2. ~/.srt-settings.json             srt's own default file, shared by every project
//   3. nothing: Serebro builds the policy from the environment form
//
// A file replaces the form's Files and Network rules. Serebro still adds the few
// entries it needs to stay safe and working (see policy.ts).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SandboxRuntimeConfigSchema } from '@anthropic-ai/sandbox-runtime';
import { Effect } from 'effect';
import type { PolicyCandidate, PolicyFileSource } from '#lib/types.ts';
import { FileSystemError, InvalidInput, PolicyInvalid } from './errors.ts';
import type { StoredEnvironment } from './schemas.ts';

export const POLICY_FILENAME = '.srt-settings.json';

export function expandHome(p: string) {
	return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function workspacePath(env: Pick<StoredEnvironment, 'workspace'>) {
	return path.resolve(expandHome(env.workspace));
}

export const globalPolicyPath = () => path.join(os.homedir(), POLICY_FILENAME);
export const projectPolicyPath = (env: Pick<StoredEnvironment, 'workspace'>) => path.join(workspacePath(env), POLICY_FILENAME);

export function customPolicyPath(env: StoredEnvironment) {
	const p = env.policyFile?.path?.trim();
	if (!p) return null;
	const abs = expandHome(p);
	return path.isAbsolute(abs) ? abs : path.join(workspacePath(env), abs);
}

/** Every file Serebro might read for this environment. The agent may never write any of them. */
export function policyCandidates(env: StoredEnvironment): PolicyCandidate[] {
	const list: PolicyCandidate[] = [];
	const custom = customPolicyPath(env);
	if (custom) list.push({ source: 'custom', path: custom, exists: fs.existsSync(custom) });
	list.push({ source: 'project', path: projectPolicyPath(env), exists: fs.existsSync(projectPolicyPath(env)) });
	list.push({ source: 'global', path: globalPolicyPath(), exists: fs.existsSync(globalPolicyPath()) });
	return list;
}

export interface ValidationResult {
	ok: boolean;
	config?: Record<string, unknown>;
	errors: string[];
}

export function validatePolicy(content: string): ValidationResult {
	let json: unknown;
	try {
		json = JSON.parse(content);
	} catch (e) {
		return { ok: false, errors: [`Not valid JSON: ${e instanceof Error ? e.message : e}`] };
	}
	const r = SandboxRuntimeConfigSchema.safeParse(json);
	if (!r.success) {
		return {
			ok: false,
			errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
		};
	}
	// Keep the file as written (the schema fills in defaults we don't want to echo back).
	return { ok: true, config: json as Record<string, unknown>, errors: [] };
}

export interface ResolvedPolicyFile {
	/** The file in use, or null when the environment form is used. */
	active: (PolicyCandidate & { content: string; hash: string; validation: ValidationResult }) | null;
	candidates: PolicyCandidate[];
}

export function hashText(s: string) {
	return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function resolvePolicyFile(env: StoredEnvironment): ResolvedPolicyFile {
	const candidates = policyCandidates(env);
	const mode = env.policyFile?.mode ?? 'auto';
	let pick: PolicyCandidate | undefined;
	if (mode === 'custom') pick = candidates.find((c) => c.source === 'custom');
	else if (mode === 'auto') pick = candidates.find((c) => c.source !== 'custom' && c.exists);
	if (!pick) return { active: null, candidates };
	// A custom file that is missing is an error, not a silent fallback.
	if (!pick.exists) {
		return {
			active: { ...pick, content: '', hash: '', validation: { ok: false, errors: [`File not found: ${pick.path}`] } },
			candidates
		};
	}
	let content: string;
	try {
		content = fs.readFileSync(pick.path, 'utf8');
	} catch (e) {
		// Unreadable (permissions, a folder, …): block the sandbox rather than crash the page.
		const reason = e instanceof Error ? e.message : String(e);
		return {
			active: { ...pick, content: '', hash: '', validation: { ok: false, errors: [`Cannot read ${pick.path}: ${reason}`] } },
			candidates
		};
	}
	return { active: { ...pick, content, hash: hashText(content), validation: validatePolicy(content) }, candidates };
}

export function pathFor(env: StoredEnvironment, target: PolicyFileSource): Effect.Effect<string, InvalidInput> {
	if (target === 'project') return Effect.succeed(projectPolicyPath(env));
	if (target === 'global') return Effect.succeed(globalPolicyPath());
	const c = customPolicyPath(env);
	return c ? Effect.succeed(c) : Effect.fail(new InvalidInput({ message: 'Set a custom policy file path on the environment first' }));
}

/** Validate and save a policy file. Refuses to write anything that srt would reject. */
export const writePolicyFile = Effect.fn('writePolicyFile')(function* (
	env: StoredEnvironment,
	target: PolicyFileSource,
	content: string
) {
	const file = yield* pathFor(env, target);
	const v = validatePolicy(content);
	if (!v.ok) return yield* new PolicyInvalid({ path: file, errors: v.errors });
	yield* Effect.tryPromise({
		try: async () => {
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			await fs.promises.writeFile(file, content.endsWith('\n') ? content : `${content}\n`);
		},
		catch: (cause) => new FileSystemError({ op: 'write', path: file, cause })
	});
	return v;
});
