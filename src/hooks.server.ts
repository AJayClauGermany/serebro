// Serebro has no login: whoever can call its API can run agents on this machine.
// So by default it only answers this machine, and only pages served by itself.
//
// - Client must connect from loopback (blocks other machines on the network).
// - Host header must be a local name (blocks DNS-rebinding attacks).
// - Origin, when sent, must be a local name (blocks other websites in your browser).
// - API writes must be JSON, which browsers cannot send cross-site without a preflight.
//
// To expose it deliberately (e.g. behind your own auth proxy), set
// SEREBRO_ALLOWED_HOSTS=serebro.example.com and SEREBRO_ALLOW_REMOTE=1.

import type { Handle } from '@sveltejs/kit/hooks';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const extraHosts = (process.env.SEREBRO_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((h) => h.trim().toLowerCase())
	.filter(Boolean);
const allowRemote = process.env.SEREBRO_ALLOW_REMOTE === '1';

function hostAllowed(hostWithPort: string | null) {
	if (!hostWithPort) return false;
	const host = hostWithPort.toLowerCase().replace(/:\d+$/, '');
	return LOCAL_HOSTS.has(host) || extraHosts.includes(host);
}

function isLoopback(addr: string) {
	return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}

const deny = (why: string) => new Response(`Forbidden: ${why}`, { status: 403 });

export const handle: Handle = async ({ event, resolve }) => {
	const { request } = event;
	if (!allowRemote) {
		let addr = '';
		try {
			addr = event.getClientAddress();
		} catch {
			// Some adapters cannot tell; fall through to the header checks.
		}
		if (addr && !isLoopback(addr)) return deny('Serebro only accepts connections from this machine');
	}
	if (!hostAllowed(request.headers.get('host'))) return deny('unknown host');
	const origin = request.headers.get('origin');
	if (origin) {
		let originHost: string | null = null;
		try {
			originHost = new URL(origin).host;
		} catch {
			// Treat an unparsable origin as foreign.
		}
		if (!hostAllowed(originHost)) return deny('cross-site request');
	}
	if (event.url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
		const type = request.headers.get('content-type') ?? '';
		const len = request.headers.get('content-length');
		const hasBody = (len !== null && len !== '0') || request.headers.has('transfer-encoding');
		if (hasBody && !type.includes('application/json')) return deny('API requests must be JSON');
	}
	return resolve(event);
};
