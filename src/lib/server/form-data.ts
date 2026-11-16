import { PACKAGE_MANAGER_DOMAINS, RECOMMENDED_DENY_READ } from './policy.ts';
import { systemStatus } from './system.ts';

export function formData() {
	const system = systemStatus();
	return {
		harnesses: system.harnesses,
		sandboxes: system.sandboxes,
		defaults: { denyRead: RECOMMENDED_DENY_READ, packageDomains: PACKAGE_MANAGER_DOMAINS }
	};
}
