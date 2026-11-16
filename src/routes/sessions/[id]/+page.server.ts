import { Effect } from 'effect';
import { page } from '#lib/server/http.ts';
import { compileFor } from '#lib/server/policy.ts';
import { Store } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = ({ params }) =>
	page(
		'page.session',
		Effect.gen(function* () {
			const store = yield* Store;
			const session = yield* store.getSession(params.id);
			const env = yield* store.getEnvironment(session.environmentId);
			return {
				session,
				messages: yield* store.getMessages(session.id),
				environment: yield* store.toView(env),
				access: (yield* compileFor(env)).report,
				harness: systemStatus().harnesses.find((h) => h.id === session.harness)!
			};
		})
	);
