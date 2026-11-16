// Runtime schemas for everything that crosses a trust boundary:
//   - data files read from disk (could be hand-edited, truncated, or from an older version)
//   - request bodies from the browser
//
// `types.ts` stays plain TypeScript so the browser bundle does not pull in Effect. The
// `Assert*` checks at the bottom fail the type-check if a schema drifts from those types.

import { Effect, Schema, SchemaIssue } from 'effect';
import type {
	CredentialInput,
	EnvironmentInput,
	EnvironmentView,
	HarnessId,
	SessionView
} from '#lib/types.ts';
import { InvalidInput } from './errors.ts';

const List = Schema.mutable(Schema.Array(Schema.String));
/** Make a struct key optional, using `value` when it is missing. */
const withDefault = <S extends Schema.Top>(schema: S, value: S['Encoded']) =>
	Schema.withDecodingDefaultKey<S>(Effect.succeed(value))(schema);

export const HarnessIdSchema = Schema.Literals(['claude-code', 'codex', 'grok-build', 'opencode', 'pi']);
const CredentialMode = Schema.Literals(['direct', 'masked']);
const PolicyFileMode = Schema.Literals(['auto', 'custom', 'off']);
const SandboxChoice = Schema.Literals(['auto', 'srt', 'nono']);

// ---------- stored data ----------

export const StoredCredential = Schema.Struct({
	name: Schema.String,
	mode: CredentialMode,
	injectHosts: List
});

const FilesystemConfig = Schema.Struct({
	readWrite: List,
	denyRead: List,
	allowRead: List,
	denyWrite: List
});

const NetworkConfig = Schema.Struct({
	allowedDomains: List,
	deniedDomains: List,
	packageManagers: Schema.Boolean,
	harnessDefaults: Schema.Boolean,
	allowLocalBinding: Schema.Boolean
});

export const DEFAULT_POLICY_FILE = { mode: 'auto', path: '', addAgentNeeds: true } as const;

const PolicyFileConfig = Schema.Struct({
	mode: PolicyFileMode,
	path: Schema.String,
	addAgentNeeds: Schema.Boolean
});

export const StoredEnvironment = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	workspace: Schema.String,
	harness: HarnessIdSchema,
	model: Schema.String,
	// Environments saved before nono support have no `sandbox`.
	sandbox: withDefault(SandboxChoice, 'auto'),
	filesystem: FilesystemConfig,
	network: NetworkConfig,
	// Environments saved before policy files existed have no `policyFile`.
	policyFile: withDefault(PolicyFileConfig, { ...DEFAULT_POLICY_FILE }),
	credentials: Schema.mutable(Schema.Array(StoredCredential)),
	createdAt: Schema.String,
	updatedAt: Schema.String
});
export type StoredEnvironment = typeof StoredEnvironment.Type;

export const Session = Schema.Struct({
	id: Schema.String,
	environmentId: Schema.String,
	title: Schema.String,
	harness: HarnessIdSchema,
	model: Schema.String,
	agentSessionId: Schema.optionalKey(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String
});

/** `secrets.json`: environment id → variable name → value. */
export const SecretMap = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String));

/** Chat transcripts are owned by the TanStack client; we only require a list of objects. */
export const Transcript = Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));

// ---------- request bodies ----------

const message = (text: string) => ({ message: text });
const InputList = withDefault(List, []);
const Text = Schema.Trim;

const EnvironmentInputSchema = Schema.Struct({
	name: Text.check(Schema.isNonEmpty(message('Name is required'))),
	workspace: Text.check(
		Schema.isNonEmpty(message('Workspace folder is required')),
		Schema.makeFilter((s: string) => s.startsWith('/') || s.startsWith('~') || 'Workspace must be an absolute path (or start with ~)')
	),
	harness: HarnessIdSchema.annotate(message('Pick a coding agent')),
	model: withDefault(Text, ''),
	sandbox: withDefault(SandboxChoice, 'auto'),
	filesystem: withDefault(
		Schema.Struct({ readWrite: InputList, denyRead: InputList, allowRead: InputList, denyWrite: InputList }),
		{}
	),
	network: withDefault(
		Schema.Struct({
		allowedDomains: InputList,
		deniedDomains: InputList,
		packageManagers: withDefault(Schema.Boolean, false),
		harnessDefaults: withDefault(Schema.Boolean, true),
			allowLocalBinding: withDefault(Schema.Boolean, false)
		}),
		{}
	),
	policyFile: withDefault(
		Schema.Struct({
			mode: withDefault(PolicyFileMode, 'auto'),
			path: withDefault(Text, ''),
			addAgentNeeds: withDefault(Schema.Boolean, true)
		}).check(
			Schema.makeFilter((p) => p.mode !== 'custom' || p.path !== '' || 'Enter the path of the custom policy file')
		),
		{}
	),
	credentials: withDefault(
		Schema.Array(
		Schema.Struct({
			name: Text.check(
				Schema.makeFilter(
					(n: string) => n === '' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || `"${n}" is not a valid environment variable name`
				)
			),
			mode: withDefault(CredentialMode, 'direct'),
			injectHosts: InputList,
				value: Schema.optionalKey(Schema.String)
			})
		),
		[]
	)
});

const clean = (list: readonly string[]) => list.map((s) => s.trim()).filter(Boolean);

/** Turn a schema failure into the `InvalidInput` the API returns. */
export function invalidInput(error: Schema.SchemaError, what = 'Request'): InvalidInput {
	const issues = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((i) => {
		const at = (i.path ?? []).map((p) => (typeof p === 'object' ? String(p.key) : String(p))).join('.');
		return at ? `${at}: ${i.message}` : i.message;
	});
	const first = issues[0] ?? `${what} is invalid`;
	return new InvalidInput({
		message: issues.length > 1 ? `${first} (and ${issues.length - 1} more)` : first,
		issues
	});
}

/** Decode `body` with `schema`, failing with a readable `InvalidInput`. */
export const decodeBody = <S extends Schema.Decoder<unknown>>(schema: S, what?: string) => {
	const decode = Schema.decodeUnknownEffect(schema, { errors: 'all' });
	return (body: unknown) => decode(body).pipe(Effect.mapError((e) => invalidInput(e, what)));
};

/** Validate and normalise an environment from the browser. */
export const decodeEnvironmentInput = (body: unknown): Effect.Effect<EnvironmentInput, InvalidInput> =>
	decodeBody(EnvironmentInputSchema, 'Environment')(body).pipe(
		Effect.map(
			(b): EnvironmentInput => ({
				name: b.name,
				workspace: b.workspace,
				harness: b.harness,
				model: b.model || 'default',
				sandbox: b.sandbox,
				filesystem: {
					readWrite: clean(b.filesystem.readWrite),
					denyRead: clean(b.filesystem.denyRead),
					allowRead: clean(b.filesystem.allowRead),
					denyWrite: clean(b.filesystem.denyWrite)
				},
				network: {
					...b.network,
					allowedDomains: clean(b.network.allowedDomains),
					deniedDomains: clean(b.network.deniedDomains)
				},
				policyFile: { ...b.policyFile },
				credentials: b.credentials.map(
					(c): CredentialInput => ({ name: c.name, mode: c.mode, injectHosts: clean(c.injectHosts), value: c.value })
				)
			})
		)
	);

export const CreateSessionBody = Schema.Struct({
	environmentId: Schema.String,
	title: Schema.optionalKey(Schema.String)
});

export const SaveMessagesBody = Schema.Struct({ messages: Transcript });

export const PolicyWriteBody = Schema.Struct({
	target: Schema.Literals(['project', 'global', 'custom']),
	content: Schema.String
});

// ---------- drift checks against types.ts ----------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assert = <T extends true>() => {};
assert<Same<typeof HarnessIdSchema.Type, HarnessId>>();
assert<Same<typeof Session.Type, SessionView>>();
assert<Same<Omit<StoredEnvironment, 'credentials'>, Omit<EnvironmentView, 'credentials'>>>();
