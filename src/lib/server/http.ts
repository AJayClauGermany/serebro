import { json } from '@sveltejs/kit';

/** Run a handler and turn thrown errors into a 400 with a readable message. */
export async function handle<T>(fn: () => T | Promise<T>, status = 200) {
	try {
		return json(await fn(), { status });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
	}
}

export function notFound(what: string) {
	return json({ error: `${what} not found` }, { status: 404 });
}
