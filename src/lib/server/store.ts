// Small JSON-file store. Everything lives in one data folder (default: ./.serebro).
//
//   environments.json   environment configs (no secret values)
//   secrets.json        credential values, file mode 0600, never sent to the browser
//   sessions.json       chat sessions
//   messages/<id>.json  chat transcripts
//   sandboxes/<id>/     generated sandbox-runtime settings + private temp dir per environment

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	CredentialInput,
	CredentialView,
	EnvironmentInput,
	EnvironmentView,
	SessionView
} from '#lib/types.ts';

export const DATA_DIR = path.resolve(process.env.SEREBRO_DATA_DIR ?? path.join(process.cwd(), '.serebro'));

interface StoredCredential {
	name: string;
	mode: CredentialView['mode'];
	injectHosts: string[];
}

export interface StoredEnvironment extends Omit<EnvironmentView, 'credentials'> {
	credentials: StoredCredential[];
}

type SecretMap = Record<string, Record<string, string>>;

function file(name: string) {
	return path.join(DATA_DIR, name);
}

function ensureDir(dir: string, mode = 0o700) {
	fs.mkdirSync(dir, { recursive: true, mode });
}

function readJson<T>(name: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T;
	} catch {
		return fallback;
	}
}

function writeJson(name: string, data: unknown, mode = 0o600) {
	ensureDir(path.dirname(file(name)));
	const target = file(name);
	const tmp = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
	fs.renameSync(tmp, target);
}

// ---------- environments ----------

export function listEnvironments(): StoredEnvironment[] {
	return readJson<StoredEnvironment[]>('environments.json', []);
}

export function getEnvironment(id: string): StoredEnvironment | undefined {
	return listEnvironments().find((e) => e.id === id);
}

function readSecrets(): SecretMap {
	return readJson<SecretMap>('secrets.json', {});
}

/** Server-only: the real credential values for an environment. */
export function getSecrets(envId: string): Record<string, string> {
	return readSecrets()[envId] ?? {};
}

export function toView(env: StoredEnvironment): EnvironmentView {
	const secrets = getSecrets(env.id);
	return {
		...env,
		credentials: env.credentials.map((c) => {
			const v = secrets[c.name] ?? '';
			return { ...c, hasValue: v.length > 0, hint: v.length >= 8 ? `…${v.slice(-4)}` : v ? '…' : '' };
		})
	};
}

function applyCredentials(envId: string, input: CredentialInput[]): StoredCredential[] {
	const all = readSecrets();
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
	writeJson('secrets.json', all);
	return stored;
}

export function createEnvironment(input: EnvironmentInput): StoredEnvironment {
	const now = new Date().toISOString();
	const id = randomUUID().slice(0, 8);
	const { credentials, ...rest } = input;
	const env: StoredEnvironment = { ...rest, id, credentials: [], createdAt: now, updatedAt: now };
	env.credentials = applyCredentials(id, credentials);
	writeJson('environments.json', [...listEnvironments(), env]);
	return env;
}

export function updateEnvironment(id: string, input: EnvironmentInput): StoredEnvironment | undefined {
	const all = listEnvironments();
	const i = all.findIndex((e) => e.id === id);
	if (i < 0) return undefined;
	const { credentials, ...rest } = input;
	const env: StoredEnvironment = {
		...all[i],
		...rest,
		credentials: applyCredentials(id, credentials),
		updatedAt: new Date().toISOString()
	};
	all[i] = env;
	writeJson('environments.json', all);
	return env;
}

export function deleteEnvironment(id: string) {
	writeJson(
		'environments.json',
		listEnvironments().filter((e) => e.id !== id)
	);
	const secrets = readSecrets();
	delete secrets[id];
	writeJson('secrets.json', secrets);
	for (const s of listSessions().filter((s) => s.environmentId === id)) deleteSession(s.id);
	fs.rmSync(sandboxDir(id), { recursive: true, force: true });
}

/** Per-environment folder holding generated srt settings and a private temp dir. */
export function sandboxDir(envId: string) {
	const dir = path.join(DATA_DIR, 'sandboxes', envId);
	ensureDir(dir);
	return dir;
}

// ---------- sessions ----------

export function listSessions(): SessionView[] {
	return readJson<SessionView[]>('sessions.json', []);
}

export function getSession(id: string): SessionView | undefined {
	return listSessions().find((s) => s.id === id);
}

export function createSession(env: StoredEnvironment, title?: string): SessionView {
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
	writeJson('sessions.json', [session, ...listSessions()]);
	return session;
}

export function patchSession(id: string, patch: Partial<Pick<SessionView, 'title' | 'agentSessionId'>>) {
	const all = listSessions();
	const i = all.findIndex((s) => s.id === id);
	if (i < 0) return;
	all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
	writeJson('sessions.json', all);
}

export function deleteSession(id: string) {
	writeJson(
		'sessions.json',
		listSessions().filter((s) => s.id !== id)
	);
	fs.rmSync(file(path.join('messages', `${id}.json`)), { force: true });
}

export function getMessages(id: string): unknown[] {
	return readJson<unknown[]>(path.join('messages', `${id}.json`), []);
}

export function saveMessages(id: string, messages: unknown[]) {
	writeJson(path.join('messages', `${id}.json`), messages);
	patchSession(id, {});
}
