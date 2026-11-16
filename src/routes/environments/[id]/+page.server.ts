import { Effect } from 'effect';
import { page } from '#lib/server/http.ts';
import { compileFor } from '#lib/server/policy.ts';
import { Store } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = ({ params }) =>
	page(
		'page.environment',
		Effect.gen(function* () {
			const store = yield* Store;
			const env = yield* store.getEnvironment(params.id);
			return {
				environment: yield* store.toView(env),
				access: (yield* compileFor(env)).report,
				harness: systemStatus().harnesses.find((h) => h.id === env.harness)!,
				sessions: (yield* store.listSessions).filter((s) => s.environmentId === env.id)
			};
		})
	);
