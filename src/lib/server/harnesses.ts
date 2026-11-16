// Registry of supported coding-agent harnesses.
//
// Each entry says what the agent needs from the sandbox to work at all (its model API
// endpoint, the config folder it writes to, the API key it reads) and how to build the
// TanStack AI adapter for it. Serebro shows all of this to the operator; nothing here is
// granted silently.

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { AnyTextAdapter } from '@tanstack/ai';
import { claudeCodeText } from '@tanstack/ai-claude-code';
import { codexText } from '@tanstack/ai-codex';
import { grokBuildText } from '@tanstack/ai-grok-build';
import { opencodeText } from '@tanstack/ai-opencode';
import { acpCompatible } from '@tanstack/ai-acp';
import type { HarnessId, HarnessInfo } from '#lib/types.ts';

export interface HarnessDefinition extends Omit<HarnessInfo, 'installed'> {
	/** Event name the adapter uses to report its native session id. */
	sessionEvent: string;
	/** Extra env vars always set for this harness (non-secret). */
	env: Record<string, string>;
	createAdapter: (model: string) => AnyTextAdapter;
}

const pi = acpCompatible({
	name: 'pi',
	// pi-acp bridges ACP <-> `pi --mode rpc`. The model is chosen in pi's own settings.
	command: () => 'pi-acp',
	skillsDir: '.pi/skills',
	permissionMode: 'bypassPermissions',
	refusalMessage: 'Pi refused the request.'
});

const HARNESSES: Record<HarnessId, HarnessDefinition> = {
	'claude-code': {
		id: 'claude-code',
		label: 'Claude Code',
		vendor: 'Anthropic',
		defaultModel: 'claude-sonnet-4-5',
		models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
		binary: 'claude',
		installHint: 'npm install -g @anthropic-ai/claude-code',
		credentialEnv: ['ANTHROPIC_API_KEY'],
		domains: ['api.anthropic.com'],
		writePaths: ['~/.claude', '~/.claude.json'],
		sessionEvent: 'claude-code.session-id',
		env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
		createAdapter: (model) =>
			claudeCodeText(model, {
				// The outer sandbox is the boundary; inside it the agent runs unattended.
				permissionMode: 'bypassPermissions',
				// Never copy the server's own API key into the agent. Keys come from the environment's credentials.
				authMode: 'host',
				settingSources: ['project']
			})
	},
	codex: {
		id: 'codex',
		label: 'Codex',
		vendor: 'OpenAI',
		defaultModel: 'gpt-5.1-codex',
		models: ['gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5.1'],
		binary: 'codex',
		installHint: 'npm install -g @openai/codex',
		credentialEnv: ['CODEX_API_KEY'],
		domains: ['api.openai.com'],
		writePaths: ['~/.codex'],
		sessionEvent: 'codex.session-id',
		env: {},
		createAdapter: (model) =>
			codexText(model, {
				// Codex's own sandbox cannot nest inside sandbox-runtime; srt is the boundary.
				sandboxMode: 'danger-full-access',
				approvalPolicy: 'never',
				skipGitRepoCheck: true,
				authMode: 'host'
			})
	},
	'grok-build': {
		id: 'grok-build',
		label: 'Grok Build',
		vendor: 'xAI',
		defaultModel: 'grok-build',
		models: ['grok-build', 'grok-build-0.1', 'composer-2.5'],
		binary: 'grok',
		installHint: 'See https://x.ai for the Grok Build CLI install instructions',
		credentialEnv: ['XAI_API_KEY'],
		domains: ['api.x.ai'],
		writePaths: ['~/.grok'],
		sessionEvent: 'grok-build.session-id',
		env: {},
		createAdapter: (model) =>
			grokBuildText(model, { permissionMode: 'bypassPermissions', authMode: 'api-key' })
	},
	opencode: {
		id: 'opencode',
		label: 'OpenCode',
		vendor: 'SST',
		defaultModel: 'anthropic/claude-sonnet-4-5',
		models: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5.1', 'xai/grok-4'],
		binary: 'opencode',
		installHint: 'npm install -g opencode-ai',
		credentialEnv: ['ANTHROPIC_API_KEY'],
		domains: ['api.anthropic.com', 'models.dev'],
		writePaths: ['~/.local/share/opencode', '~/.config/opencode', '~/.cache/opencode', '~/.local/state/opencode'],
		notes:
			'OpenCode runs a local HTTP server inside the sandbox. Local port binding is turned on for it. On Linux the sandbox has its own network namespace, so the server is not reachable from the host yet; use macOS or another agent there.',
		sessionEvent: 'opencode.session-id',
		env: {},
		createAdapter: (model) => opencodeText(model, { permissionMode: 'bypassPermissions', hostname: '127.0.0.1' })
	},
	pi: {
		id: 'pi',
		label: 'Pi',
		vendor: 'Earendil',
		defaultModel: 'default',
		models: ['default'],
		binary: 'pi-acp',
		installHint: 'npm install -g @earendil-works/pi-coding-agent pi-acp',
		credentialEnv: ['ANTHROPIC_API_KEY'],
		domains: ['api.anthropic.com'],
		writePaths: ['~/.pi'],
		notes: "Pi picks its model from its own settings (~/.pi/agent/settings.json). Add the matching provider's API domain and key.",
		sessionEvent: 'pi.session-id',
		env: {},
		createAdapter: (model) => pi(model) as unknown as AnyTextAdapter
	}
};

export const HARNESS_IDS = Object.keys(HARNESSES) as HarnessId[];

export function getHarness(id: HarnessId): HarnessDefinition {
	const h = HARNESSES[id];
	if (!h) throw new Error(`Unknown agent "${id}"`);
	return h;
}

export function which(binary: string): string | null {
	try {
		const out = execFileSync(os.platform() === 'win32' ? 'where' : 'which', [binary], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return out.trim().split('\n')[0] || null;
	} catch {
		return null;
	}
}

export function listHarnesses(): HarnessInfo[] {
	return HARNESS_IDS.map((id) => {
		const { sessionEvent: _s, env: _e, createAdapter: _c, ...info } = HARNESSES[id];
		return { ...info, installed: which(info.binary) !== null };
	});
}
