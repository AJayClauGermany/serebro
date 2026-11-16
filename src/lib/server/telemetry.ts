// Optional OpenTelemetry export. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
//
// The spans already in the code (route labels like `api.chat`, `Effect.fn` names like
// `store.createEnvironment`, `agent.turn`) and the logs are sent to an OTLP/HTTP collector
// (JSON encoding), e.g. Jaeger, Grafana Tempo/Alloy or the OpenTelemetry Collector.
//
// NOTE: `effect/observability` and `effect/http` are marked *unstable* in Effect 4.1. They
// are only imported here, so if their API changes, this is the one file to update.

import { Layer, Option } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Otlp } from 'effect/observability';
import { serverConfig } from './config.ts';

export const TelemetryLayer = Option.match(serverConfig.otlpEndpoint, {
	onNone: () => Layer.empty,
	onSome: (baseUrl) =>
		Otlp.layerJson({
			baseUrl,
			resource: { serviceName: process.env.OTEL_SERVICE_NAME || 'serebro' },
			// Keep printing logs to the console as well.
			loggerMergeWithExisting: true
		}).pipe(Layer.provide(FetchHttpClient.layer))
});
