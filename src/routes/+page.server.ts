import { compilePolicy } from '#lib/server/policy.ts';
import { listEnvironments, listSessions, toView } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = () => {
	const envs = listEnvironments();
	return {
		system: systemStatus(),
		environments: envs.map((e) => ({ env: toView(e), access: compilePolicy(e).report })),
		sessions: listSessions().slice(0, 20)
	};
};
