// Runs route effects and turns their result into an HTTP response.
//
// Expected failures are tagged errors (errors.ts) and map to a status here, in one
// exhaustive switch: adding a new error type without deciding its status is a type error.
// Anything else is a defect: it is logged with its full cause and the client gets a 500.

import { error as kitError, json } from '@sveltejs/kit';
import { Cause, Effect, Exit } from 'effect';
import type { AppError } from './errors.ts';
import { InvalidInput } from './errors.ts';
import { runtime, type AppServices } from './runtime.ts';

type RouteEffect<A> = Effect.Effect<A, AppError, AppServices>;

function status(e: AppError): number {
	switch (e._tag) {
		case 'NotFound':
			return 404;
		case 'InvalidInput':
			return 400;
		case 'PolicyInvalid':
			return 422;
		case 'SandboxBlocked':
			return 409;
		case 'FileSystemError':
		case 'StoreCorrupt':
			return 500;
	}
}

function body(e: AppError): Record<string, unknown> {
	switch (e._tag) {
		case 'InvalidInput':
			return { error: e.message, ...(e.issues ? { errors: e.issues } : {}) };
		case 'PolicyInvalid':
			return { error: e.message, errors: e.errors };
		default:
			return { error: e.message };
	}
}

type Outcome<A> = { ok: true; value: A } | { ok: false; error: AppError } | { ok: false; error: null };

/** Run an effect. Expected errors are returned; defects are logged with their full cause. */
async function run<A>(effect: RouteEffect<A>, label: string): Promise<Outcome<A>> {
	const exit = await runtime.runPromiseExit(effect.pipe(Effect.withSpan(label)));
	if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
	const failure = Cause.findError(exit.cause);
	if (failure._tag === 'Success' && !Cause.hasDies(exit.cause)) {
		const e = failure.success;
		if (status(e) >= 500) await runtime.runPromise(Effect.logError(`${label} failed: ${e._tag}`, e.message));
		return { ok: false, error: e };
	}
	// Interrupted (the client went away) or a bug: nothing useful to tell the client.
	if (!Cause.hasInterruptsOnly(exit.cause)) {
		await runtime.runPromise(Effect.logError(`Unexpected failure in ${label}`, Cause.pretty(exit.cause)));
	}
	return { ok: false, error: null };
}

const INTERNAL = 'Internal error. See the server log for details.';

/** API route returning JSON. */
export async function api<A>(label: string, effect: RouteEffect<A>, successStatus = 200): Promise<Response> {
	const r = await run(effect, label);
	if (!r.ok) return r.error ? json(body(r.error), { status: status(r.error) }) : json({ error: INTERNAL }, { status: 500 });
	if (r.value instanceof Response) return r.value;
	if (r.value === undefined) return new Response(null, { status: 204 });
	return json(r.value, { status: successStatus });
}

/** Page `load` function: expected errors become SvelteKit error pages. */
export async function page<A>(label: string, effect: RouteEffect<A>): Promise<A> {
	const r = await run(effect, label);
	if (r.ok) return r.value;
	const s = r.error ? status(r.error) : 500;
	kitError(s, s >= 500 ? 'Serebro hit an error. See the server log for details.' : r.error!.message);
}

/** Parse the request body as JSON. */
export const requestJson = (request: Request) =>
	Effect.tryPromise({
		try: () => request.json() as Promise<unknown>,
		catch: () => new InvalidInput({ message: 'The request body must be valid JSON' })
	});
