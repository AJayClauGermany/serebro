// Every failure the server expects is one of these tagged errors. Each Effect's type says
// which ones it can fail with, so the compiler points out unhandled cases, and
// `http.ts` turns each into one HTTP status in one place.
//
// Anything else (a thrown exception, a bug) is a *defect*: it is logged with its full
// cause and the client gets a generic 500.

import { Schema } from 'effect';

/** A record the request refers to does not exist. → 404 */
export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
	entity: Schema.Literals(['Environment', 'Session']),
	id: Schema.String
}) {
	override get message() {
		return `${this.entity} not found`;
	}
}

/** The request body is malformed or fails validation. → 400 */
export class InvalidInput extends Schema.TaggedError<InvalidInput>()('InvalidInput', {
	message: Schema.String,
	issues: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

/** A sandbox policy file failed srt's schema; nothing was written. → 422 */
export class PolicyInvalid extends Schema.TaggedError<PolicyInvalid>()('PolicyInvalid', {
	path: Schema.String,
	errors: Schema.Array(Schema.String)
}) {
	override get message() {
		return 'The file was not saved.';
	}
}

/** The environment's policy says the sandbox must not start. → 409 */
export class SandboxBlocked extends Schema.TaggedError<SandboxBlocked>()('SandboxBlocked', {
	message: Schema.String
}) {}

/** Reading or writing a file failed (permissions, disk full, …). → 500 */
export class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
	op: Schema.Literals(['read', 'write', 'remove', 'mkdir']),
	path: Schema.String,
	cause: Schema.Defect()
}) {
	override get message() {
		const reason = this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Could not ${this.op} ${this.path}: ${reason}`;
	}
}

/**
 * A data file exists but does not contain what Serebro expects (hand-edited, truncated,
 * written by another version). Serebro refuses to overwrite it. → 500
 */
export class StoreCorrupt extends Schema.TaggedError<StoreCorrupt>()('StoreCorrupt', {
	path: Schema.String,
	detail: Schema.String
}) {
	override get message() {
		return `Data file ${this.path} is unreadable, so Serebro will not overwrite it. Fix or move it, then retry.\n${this.detail}`;
	}
}

export type AppError = NotFound | InvalidInput | PolicyInvalid | SandboxBlocked | FileSystemError | StoreCorrupt;
