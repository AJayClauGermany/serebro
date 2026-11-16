import { Effect } from 'effect';
import { page } from '#lib/server/http.ts';
import { compileFor } from '#lib/server/policy.ts';
import { Store } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = () =>
	page(
		'page.home',
		Effect.gen(function* () {
			const store = yield* Store;
			const envs = yield* store.listEnvironments;
			return {
				system: systemStatus(),
				environments: yield* Effect.forEach(envs, (e) =>
					Effect.all({ env: store.toView(e), access: compileFor(e).pipe(Effect.map((c) => c.report)) })
				),
				sessions: (yield* store.listSessions).slice(0, 20)
			};
		})
	);
