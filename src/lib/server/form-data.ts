import { PACKAGE_MANAGER_DOMAINS, RECOMMENDED_DENY_READ } from './policy.ts';
import { systemStatus } from './system.ts';

export function formData() {
	return {
		harnesses: systemStatus().harnesses,
		defaults: { denyRead: RECOMMENDED_DENY_READ, packageDomains: PACKAGE_MANAGER_DOMAINS }
	};
}
