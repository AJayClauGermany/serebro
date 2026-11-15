import { error } from '@sveltejs/kit';
import { compilePolicy } from '#lib/server/policy.ts';
import { getEnvironment, getMessages, getSession, toView } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = ({ params }) => {
	const session = getSession(params.id);
	if (!session) error(404, 'Chat not found');
	const env = getEnvironment(session.environmentId);
	if (!env) error(404, 'This chat’s environment was deleted');
	return {
		session,
		messages: getMessages(session.id),
		environment: toView(env),
		access: compilePolicy(env).report,
		harness: systemStatus().harnesses.find((h) => h.id === session.harness)!
	};
};
