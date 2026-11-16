// Server settings read from environment variables, validated once at startup.
//
// A bad value (for example SEREBRO_ALLOW_REMOTE=maybe) stops the server with a clear
// message instead of silently falling back to a default.

import path from 'node:path';
import { Config, Duration, Effect } from 'effect';

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
	srtBin: Config.String('SEREBRO_SRT_BIN').pipe(Config.option),
	// Path to the nono binary, when it is not on PATH.
	nonoBin: Config.String('SEREBRO_NONO_BIN').pipe(Config.option),
	// Limits for one agent turn, e.g. "45 minutes". "Infinity" turns a limit off.
	turnTimeout: Config.Duration('SEREBRO_TURN_TIMEOUT').pipe(Config.withDefault(Duration.minutes(60))),
	idleTimeout: Config.Duration('SEREBRO_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.minutes(15))),
	// Send traces and logs to an OpenTelemetry collector (OTLP/HTTP JSON), e.g. http://localhost:4318
	otlpEndpoint: Config.String('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.option)
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
