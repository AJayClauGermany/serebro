// Server settings read from environment variables, validated once at startup.
//
// A bad value (for example SEREBRO_ALLOW_REMOTE=maybe) stops the server with a clear
// message instead of silently falling back to a default.

import path from 'node:path';
import { Config, Effect } from 'effect';

const ServerConfigSchema = Config.all({
	dataDir: Config.String('SEREBRO_DATA_DIR').pipe(Config.withDefault(path.join(process.cwd(), '.serebro'))),
	allowedHosts: Config.String('SEREBRO_ALLOWED_HOSTS').pipe(
		Config.withDefault(''),
		Config.map((s) =>
			s
				.split(',')
				.map((h) => h.trim().toLowerCase())
				.filter(Boolean)
		)
	),
	allowRemote: Config.Boolean('SEREBRO_ALLOW_REMOTE').pipe(Config.withDefault(false)),
	srtBin: Config.String('SEREBRO_SRT_BIN').pipe(Config.option)
});

export type ServerConfig = Config.Success<typeof ServerConfigSchema>;

function load(): ServerConfig {
	try {
		return Effect.runSync(ServerConfigSchema);
	} catch (e) {
		throw new Error(`Invalid Serebro configuration: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export const serverConfig: ServerConfig = load();

export const DATA_DIR = path.resolve(serverConfig.dataDir);
