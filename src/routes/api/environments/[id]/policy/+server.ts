// Read and edit the sandbox policy file for an environment.
import { json } from '@sveltejs/kit';
import { notFound } from '#lib/server/http.ts';
import { compilePolicy, starterPolicy } from '#lib/server/policy.ts';
import { resolvePolicyFile, writePolicyFile } from '#lib/server/policy-file.ts';
import { getEnvironment } from '#lib/server/store.ts';
import type { PolicyFileSource, PolicyFileState } from '#lib/types.ts';

export const GET = ({ params, url }) => {
	const env = getEnvironment(params.id);
	if (!env) return notFound('Environment');
	const { report } = compilePolicy(env);
	// Cheap poll used by the chat page to notice edits.
	if (url.searchParams.has('hash')) return json({ hash: report.hash, blocked: report.blocked });
	const r = resolvePolicyFile(env);
	const state: PolicyFileState = {
		mode: env.policyFile.mode,
		candidates: r.candidates,
		active: r.active
			? { source: r.active.source, path: r.active.path, exists: r.active.exists, content: r.active.content, errors: r.active.validation.errors }
			: null,
		starter: starterPolicy(env),
		hash: report.hash
	};
	return json(state);
};

/** Body: { target: 'project' | 'global' | 'custom', content: string } */
export const PUT = async ({ params, request }) => {
	const env = getEnvironment(params.id);
	if (!env) return notFound('Environment');
	const body = await request.json();
	const target = body.target as PolicyFileSource;
	if (!['project', 'global', 'custom'].includes(target)) return json({ error: 'Unknown target' }, { status: 400 });
	try {
		const v = writePolicyFile(env, target, String(body.content ?? ''));
		if (!v.ok) return json({ error: 'The file was not saved.', errors: v.errors }, { status: 422 });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
	}
	return json({ ok: true, hash: compilePolicy(env).report.hash });
};
