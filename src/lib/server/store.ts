// Small JSON-file store. Everything lives in one data folder (default: ./.serebro).
//
//   environments.json   environment configs (no secret values)
//   secrets.json        credential values, file mode 0600, never sent to the browser
//   sessions.json       chat sessions
//   messages/<id>.json  chat transcripts
//   sandboxes/<id>/     generated sandbox-runtime settings per environment
//
// Every file is checked against its schema when read. A missing file means "empty"; a file
// that exists but cannot be parsed fails with `StoreCorrupt` and is never overwritten, so a
// bad edit cannot silently wipe the data. Writes are atomic (temp file + rename), and all
// read-modify-write operations run one at a time.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context, Effect, Layer, Schema, Semaphore } from 'effect';
import type { CredentialInput, EnvironmentInput, EnvironmentView, SessionView } from '#lib/types.ts';
import { DATA_DIR } from './config.ts';
import { FileSystemError, NotFound, StoreCorrupt } from './errors.ts';
import { SecretMap, Session, StoredEnvironment as StoredEnvironmentSchema, Transcript, type StoredEnvironment } from './schemas.ts';

export { DATA_DIR };
export type { StoredEnvironment };
type StoredCredential = StoredEnvironment['credentials'][number];
type Secrets = Record<string, Record<string, string>>;

export type StoreError = FileSystemError | StoreCorrupt;

// ---------- file helpers ----------

const file = (name: string) => path.join(DATA_DIR, name);

const mkdir = (dir: string, mode = 0o700) =>
	Effect.tryPromise({
		try: () => fs.mkdir(dir, { recursive: true, mode }),
		catch: (cause) => new FileSystemError({ op: 'mkdir', path: dir, cause })
	}).pipe(Effect.asVoid);

const remove = (target: string, recursive = false) =>
	Effect.tryPromise({
		try: () => fs.rm(target, { force: true, recursive }),
		catch: (cause) => new FileSystemError({ op: 'remove', path: target, cause })
	});

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Read and validate a JSON file. A missing file returns `fallback`. */
function readJson<S extends Schema.Decoder<unknown>>(name: string, schema: S, fallback: S['Type']) {
	const target = file(name);
	const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
	return Effect.tryPromise({
		try: () => fs.readFile(target, 'utf8').catch((e) => (isMissing(e) ? null : Promise.reject(e))),
		catch: (cause) => new FileSystemError({ op: 'read', path: target, cause })
	}).pipe(
		Effect.flatMap((text) =>
			text === null
				? Effect.succeed(fallback)
				: decode(text).pipe(Effect.mapError((e) => new StoreCorrupt({ path: target, detail: e.message })))
		),
		Effect.withSpan('store.read', { attributes: { file: name } })
	) as Effect.Effect<S['Type'], StoreError, S['DecodingServices']>;
}

function writeJson(name: string, data: unknown, mode = 0o600) {
	const target = file(name);
	const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
	return mkdir(path.dirname(target)).pipe(
		Effect.andThen(
			Effect.tryPromise({
				try: async () => {
					await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode });
					await fs.rename(tmp, target);
				},
				catch: (cause) => new FileSystemError({ op: 'write', path: target, cause })
			})
		),
		Effect.tapError(() => Effect.promise(() => fs.rm(tmp, { force: true }))),
		Effect.withSpan('store.write', { attributes: { file: name } })
	);
}

const messagesFile = (sessionId: string) => path.join('messages', `${sessionId}.json`);

// ---------- service ----------

export interface StoreShape {
	readonly listEnvironments: Effect.Effect<StoredEnvironment[], StoreError>;
	readonly getEnvironment: (id: string) => Effect.Effect<StoredEnvironment, NotFound | StoreError>;
	readonly createEnvironment: (input: EnvironmentInput) => Effect.Effect<StoredEnvironment, StoreError>;
	readonly updateEnvironment: (id: string, input: EnvironmentInput) => Effect.Effect<StoredEnvironment, NotFound | StoreError>;
	/** Removes the environment, its secrets, chats and generated sandbox files. No-op if unknown. */
	readonly deleteEnvironment: (id: string) => Effect.Effect<void, StoreError>;
	/** Server-only: the real credential values for an environment. */
	readonly getSecrets: (envId: string) => Effect.Effect<Record<string, string>, StoreError>;
	/** The browser-safe view: secret values replaced by `hasValue` and a short hint. */
	readonly toView: (env: StoredEnvironment) => Effect.Effect<EnvironmentView, StoreError>;
	/** Per-environment folder holding generated srt settings. Created on demand. */
	readonly sandboxDir: (envId: string) => Effect.Effect<string, FileSystemError>;

	readonly listSessions: Effect.Effect<SessionView[], StoreError>;
	readonly getSession: (id: string) => Effect.Effect<SessionView, NotFound | StoreError>;
	readonly createSession: (env: StoredEnvironment, title?: string) => Effect.Effect<SessionView, StoreError>;
	readonly patchSession: (
		id: string,
		patch: Partial<Pick<SessionView, 'title' | 'agentSessionId'>>
	) => Effect.Effect<void, NotFound | StoreError>;
	/** No-op if unknown. */
	readonly deleteSession: (id: string) => Effect.Effect<void, StoreError>;
	readonly getMessages: (id: string) => Effect.Effect<unknown[], StoreError>;
	readonly saveMessages: (id: string, messages: unknown[]) => Effect.Effect<void, NotFound | StoreError>;
}

export class Store extends Context.Service<Store, StoreShape>()('serebro/Store') {
	static readonly layer = Layer.effect(
		Store,
		Effect.gen(function* () {
			// One writer at a time, so concurrent requests cannot lose each other's updates.
			const lock = (yield* Semaphore.make(1)).withPermits(1);

			const readEnvironments = readJson('environments.json', Schema.Array(StoredEnvironmentSchema), []).pipe(
				Effect.map((list) => [...list])
			);
			const readSessions = readJson('sessions.json', Schema.Array(Session), []).pipe(
				Effect.map((list): SessionView[] => [...list])
			);
			const readSecrets = readJson('secrets.json', SecretMap, {}).pipe(Effect.map((s): Secrets => ({ ...s })));

			const getEnvironment = (id: string) =>
				readEnvironments.pipe(
					Effect.map((all) => all.find((e) => e.id === id)),
					Effect.flatMap((env) => (env ? Effect.succeed(env) : Effect.fail(new NotFound({ entity: 'Environment', id }))))
				);

			const getSession = (id: string) =>
				readSessions.pipe(
					Effect.map((all) => all.find((s) => s.id === id)),
					Effect.flatMap((s) => (s ? Effect.succeed(s) : Effect.fail(new NotFound({ entity: 'Session', id }))))
				);

			const getSecrets = (envId: string) => readSecrets.pipe(Effect.map((all) => all[envId] ?? {}));

			const applyCredentials = Effect.fn('store.applyCredentials')(function* (envId: string, input: CredentialInput[]) {
				const all = yield* readSecrets;
				const prev = all[envId] ?? {};
				const next: Record<string, string> = {};
				const stored: StoredCredential[] = [];
				for (const c of input) {
					const name = c.name.trim();
					if (!name) continue;
					const value = c.value && c.value.length > 0 ? c.value : prev[name];
					if (value) next[name] = value;
					stored.push({ name, mode: c.mode, injectHosts: c.injectHosts });
				}
				all[envId] = next;
				yield* writeJson('secrets.json', all);
				return stored;
			});

			const patchSessionUnlocked = Effect.fn('store.patchSession')(function* (
				id: string,
				patch: Partial<Pick<SessionView, 'title' | 'agentSessionId'>>
			) {
				const all = yield* readSessions;
				const i = all.findIndex((s) => s.id === id);
				if (i < 0) return yield* new NotFound({ entity: 'Session', id });
				all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
				yield* writeJson('sessions.json', all);
			});

			const deleteSessionUnlocked = Effect.fn('store.deleteSession')(function* (id: string) {
				const all = yield* readSessions;
				// Only touch the transcript of a session we know, never a path built from raw input.
				if (!all.some((s) => s.id === id)) return;
				yield* writeJson(
					'sessions.json',
					all.filter((s) => s.id !== id)
				);
				yield* remove(file(messagesFile(id)));
			});

			const sandboxDir = (envId: string) => {
				const dir = path.join(DATA_DIR, 'sandboxes', envId);
				return mkdir(dir).pipe(Effect.as(dir));
			};

			return Store.of({
				listEnvironments: readEnvironments,
				getEnvironment,
				getSecrets,
				sandboxDir,

				toView: (env) =>
					getSecrets(env.id).pipe(
						Effect.map(
							(secrets): EnvironmentView => ({
								...env,
								credentials: env.credentials.map((c) => {
									const v = secrets[c.name] ?? '';
									return { ...c, hasValue: v.length > 0, hint: v.length >= 8 ? `…${v.slice(-4)}` : v ? '…' : '' };
								})
							})
						)
					),

				createEnvironment: Effect.fn('store.createEnvironment')(function* (input) {
					const now = new Date().toISOString();
					const id = randomUUID().slice(0, 8);
					const { credentials, ...rest } = input;
					const all = yield* readEnvironments;
					const env: StoredEnvironment = {
						...rest,
						id,
						credentials: yield* applyCredentials(id, credentials),
						createdAt: now,
						updatedAt: now
					};
					yield* writeJson('environments.json', [...all, env]);
					return env;
				}, lock),

				updateEnvironment: Effect.fn('store.updateEnvironment')(function* (id, input) {
					const all = yield* readEnvironments;
					const i = all.findIndex((e) => e.id === id);
					if (i < 0) return yield* new NotFound({ entity: 'Environment', id });
					const { credentials, ...rest } = input;
					const env: StoredEnvironment = {
						...all[i],
						...rest,
						credentials: yield* applyCredentials(id, credentials),
						updatedAt: new Date().toISOString()
					};
					all[i] = env;
					yield* writeJson('environments.json', all);
					return env;
				}, lock),

				deleteEnvironment: Effect.fn('store.deleteEnvironment')(function* (id) {
					const all = yield* readEnvironments;
					// An unknown id must never reach the rm -r below (think `..`).
					if (!all.some((e) => e.id === id)) return;
					yield* writeJson(
						'environments.json',
						all.filter((e) => e.id !== id)
					);
					const secrets = yield* readSecrets;
					delete secrets[id];
					yield* writeJson('secrets.json', secrets);
					for (const s of (yield* readSessions).filter((s) => s.environmentId === id)) yield* deleteSessionUnlocked(s.id);
					yield* remove(path.join(DATA_DIR, 'sandboxes', id), true);
				}, lock),

				listSessions: readSessions,
				getSession,

				createSession: Effect.fn('store.createSession')(function* (env, title) {
					const now = new Date().toISOString();
					const session: SessionView = {
						id: randomUUID(),
						environmentId: env.id,
						title: title?.trim() || `${env.name} · ${new Date().toLocaleString()}`,
						harness: env.harness,
						model: env.model,
						createdAt: now,
						updatedAt: now
					};
					yield* writeJson('sessions.json', [session, ...(yield* readSessions)]);
					return session;
				}, lock),

				patchSession: (id, patch) => lock(patchSessionUnlocked(id, patch)),
				deleteSession: (id) => lock(deleteSessionUnlocked(id)),

				getMessages: (id) =>
					getSession(id).pipe(
						Effect.andThen(readJson(messagesFile(id), Transcript, [])),
						Effect.catchTag('NotFound', () => Effect.succeed([]))
					),

				saveMessages: Effect.fn('store.saveMessages')(function* (id, messages) {
					yield* getSession(id);
					yield* writeJson(messagesFile(id), messages);
					yield* patchSessionUnlocked(id, {});
				}, lock)
			});
		})
	);
}
