import { Effect } from 'effect';
import { formData } from '#lib/server/form-data.ts';
import { page } from '#lib/server/http.ts';
import { Store } from '#lib/server/store.ts';

export const load = ({ params }) =>
	page(
		'page.environment.edit',
		Effect.gen(function* () {
			const store = yield* Store;
			return { ...formData(), environment: yield* store.toView(yield* store.getEnvironment(params.id)) };
		})
	);
