import { error } from '@sveltejs/kit';
import { formData } from '#lib/server/form-data.ts';
import { getEnvironment, toView } from '#lib/server/store.ts';

export const load = ({ params }) => {
	const env = getEnvironment(params.id);
	if (!env) error(404, 'Environment not found');
	return { ...formData(), environment: toView(env) };
};
