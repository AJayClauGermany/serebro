// The single Effect runtime for the server. Route handlers run their effects through it
// (see http.ts); it owns long-lived services such as the store and its write lock, and the
// optional telemetry exporter.

import { Layer, ManagedRuntime } from 'effect';
import { Store } from './store.ts';
import { TelemetryLayer } from './telemetry.ts';

export type AppServices = Store;

export const runtime = ManagedRuntime.make(Layer.mergeAll(Store.layer, TelemetryLayer));
