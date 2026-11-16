// Shared types used by both the server and the browser.
// Secrets never cross this boundary: the browser only ever sees `CredentialView`.

export type HarnessId = 'claude-code' | 'codex' | 'grok-build' | 'opencode' | 'pi';

/** How a credential is handed to the agent. */
export type CredentialMode =
	/** The real value is placed in the agent's environment. The agent can read and print it. */
	| 'direct'
	/**
	 * The agent sees a placeholder. The sandbox proxy swaps in the real value only on
	 * HTTPS requests to `injectHosts`. Uses sandbox-runtime credential masking (experimental).
	 */
	| 'masked';

export interface CredentialView {
	/** Environment variable name, e.g. ANTHROPIC_API_KEY. */
	name: string;
	mode: CredentialMode;
	/** Hosts the real value may be sent to (masked mode only). Empty = all allowed domains. */
	injectHosts: string[];
	/** True when a value is stored on the server. */
	hasValue: boolean;
	/** Last 4 characters, for recognition only. */
	hint: string;
}

export interface CredentialInput {
	name: string;
	mode: CredentialMode;
	injectHosts: string[];
	/** New value. Omit (or leave empty) to keep the stored one. */
	value?: string;
}

export interface FilesystemConfig {
	/** Extra host paths the agent may write (the workspace folder is always writable). */
	readWrite: string[];
	/**
	 * Paths the agent may NOT read. Reads elsewhere are allowed by default
	 * (this is how sandbox-runtime works: deny-list for reads, allow-list for writes).
	 */
	denyRead: string[];
	/** Paths re-allowed for reading inside a denied region. */
	allowRead: string[];
	/** Paths the agent may never write, even inside writable folders. */
	denyWrite: string[];
}

export interface NetworkConfig {
	/** Domains the agent may connect to. Wildcards like `*.example.com` are allowed. */
	allowedDomains: string[];
	/** Always blocked, even if matched by an allowed wildcard. */
	deniedDomains: string[];
	/** Add the common package registries (npm, PyPI, crates.io, Go proxy, GitHub). */
	packageManagers: boolean;
	/** Add the endpoints the selected agent needs to reach its model API. */
	harnessDefaults: boolean;
	/** Allow the agent to open local ports (dev servers). */
	allowLocalBinding: boolean;
}

/** A sandbox that can enforce an environment's rules. */
export type SandboxBackendId =
	/** Anthropic sandbox-runtime: bubblewrap (Linux) or Seatbelt (macOS) plus a filtering proxy. */
	| 'srt'
	/** nono: Landlock (Linux) or Seatbelt (macOS) plus a filtering proxy. One binary, no bubblewrap. */
	| 'nono';

/** Which sandbox an environment asks for. `auto` prefers srt and uses nono when srt cannot run. */
export type SandboxChoice = 'auto' | SandboxBackendId;

/** Where the sandbox policy comes from. */
export type PolicyFileMode =
	/** Use <workspace>/.srt-settings.json, else ~/.srt-settings.json, else the form. */
	| 'auto'
	/** Use the file at `path` (it must exist). */
	| 'custom'
	/** Always use the environment form. */
	| 'off';

export type PolicyFileSource = 'project' | 'global' | 'custom';

export interface PolicyFileConfig {
	mode: PolicyFileMode;
	/** Custom file path (absolute, ~/…, or relative to the workspace). */
	path: string;
	/** Add the agent's config folders and model API domains on top of the file. */
	addAgentNeeds: boolean;
}

export interface PolicyCandidate {
	source: PolicyFileSource;
	path: string;
	exists: boolean;
}

export interface EnvironmentView {
	id: string;
	name: string;
	/** Host folder the agent works in. Always readable and writable. */
	workspace: string;
	harness: HarnessId;
	model: string;
	sandbox: SandboxChoice;
	filesystem: FilesystemConfig;
	network: NetworkConfig;
	policyFile: PolicyFileConfig;
	credentials: CredentialView[];
	createdAt: string;
	updatedAt: string;
}

export interface EnvironmentInput {
	name: string;
	workspace: string;
	harness: HarnessId;
	model: string;
	sandbox: SandboxChoice;
	filesystem: FilesystemConfig;
	network: NetworkConfig;
	policyFile: PolicyFileConfig;
	credentials: CredentialInput[];
}

/** Why an entry is in the effective policy. */
export type AccessSource = 'workspace' | 'you' | 'agent' | 'packages' | 'default' | 'runtime' | 'file';

export interface AccessEntry {
	value: string;
	source: AccessSource;
	note?: string;
}

/** The effective, compiled view of what an agent in this environment can and cannot touch. */
export interface AccessReport {
	/** The sandbox that enforces these rules. */
	sandbox: {
		id: SandboxBackendId;
		label: string;
		/** Why this one (the environment asked for it, or auto picked it). */
		reason: string;
	};
	filesystem: {
		readWrite: AccessEntry[];
		/** Extra read-only grants. Only used by sandboxes where reads are an allow-list (nono). */
		readOnly: AccessEntry[];
		readOnlyNote: string;
		denyRead: AccessEntry[];
		allowRead: AccessEntry[];
		denyWrite: AccessEntry[];
	};
	network: {
		allowed: AccessEntry[];
		denied: AccessEntry[];
		localBinding: boolean;
		note: string;
	};
	credentials: {
		direct: AccessEntry[];
		masked: AccessEntry[];
		missing: AccessEntry[];
	};
	/** Where the rules come from. */
	policy: {
		source: 'form' | PolicyFileSource;
		/** Path of the policy file in use. */
		path?: string;
		/** Top-level settings from the file that are passed through unchanged. */
		otherKeys: string[];
	};
	/** Hash of the effective sandbox settings. Changes whenever the sandbox would change. */
	hash: string;
	/** Set when the sandbox must not start (an invalid policy file, a rule the sandbox cannot enforce). */
	blocked: string | null;
	/** Raw settings handed to the sandbox: srt settings or a nono profile (secrets are never included). */
	rawSettings: unknown;
	warnings: string[];
}

export interface PolicyFileState {
	mode: PolicyFileMode;
	candidates: PolicyCandidate[];
	active: (PolicyCandidate & { content: string; errors: string[] }) | null;
	/** A starting point built from the environment form, for creating a new file. */
	starter: string;
	/** Hash of the effective sandbox settings (same as AccessReport.hash). */
	hash: string;
}

export interface HarnessInfo {
	id: HarnessId;
	label: string;
	vendor: string;
	defaultModel: string;
	models: string[];
	binary: string;
	installHint: string;
	credentialEnv: string[];
	domains: string[];
	writePaths: string[];
	notes?: string;
	installed: boolean;
}

export interface SystemCheck {
	name: string;
	ok: boolean;
	detail: string;
	fix?: string;
}

export interface SandboxBackendInfo {
	id: SandboxBackendId;
	label: string;
	/** True when everything this sandbox needs is installed. */
	available: boolean;
	/** True for the one `auto` picks on this machine. */
	preferred: boolean;
	checks: SystemCheck[];
}

export interface SystemStatus {
	platform: string;
	/** True when at least one sandbox can run. */
	ready: boolean;
	/** Checks to show: those of the sandbox `auto` picks, plus general ones. */
	checks: SystemCheck[];
	sandboxes: SandboxBackendInfo[];
	harnesses: HarnessInfo[];
	dataDir: string;
}

export interface SessionView {
	id: string;
	environmentId: string;
	title: string;
	harness: HarnessId;
	model: string;
	/** Harness-native session id, used to resume the agent's own context. */
	agentSessionId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProbeResult {
	name: string;
	command: string;
	expect: 'allowed' | 'blocked';
	outcome: 'allowed' | 'blocked';
	pass: boolean;
	output: string;
}
