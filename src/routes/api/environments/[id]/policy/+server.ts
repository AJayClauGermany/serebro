// Read and edit the sandbox policy file for an environment.
import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { compileFor, starterPolicy } from '#lib/server/policy.ts';
import { resolvePolicyFile, writePolicyFile } from '#lib/server/policy-file.ts';
import { decodeBody, PolicyWriteBody } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';
import type { PolicyFileState } from '#lib/types.ts';

export const GET = ({ params, url }) =>
	api(
		'api.environments.policy.get',
		Effect.gen(function* () {
			const env = yield* (yield* Store).getEnvironment(params.id);
			const { report } = yield* compileFor(env);
			// Cheap poll used by the chat page to notice edits.
			if (url.searchParams.has('hash')) return { hash: report.hash, blocked: report.blocked };
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
			return state;
		})
	);

/** Body: { target: 'project' | 'global' | 'custom', content: string } */
export const PUT = ({ params, request }) =>
	api(
		'api.environments.policy.put',
		Effect.gen(function* () {
			const env = yield* (yield* Store).getEnvironment(params.id);
			const body = yield* requestJson(request).pipe(Effect.flatMap(decodeBody(PolicyWriteBody)));
			yield* writePolicyFile(env, body.target, body.content);
			return { ok: true, hash: (yield* compileFor(env)).report.hash };
		})
	);
