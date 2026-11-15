// The single Effect runtime for the server. Route handlers run their effects through it
// (see http.ts); it owns long-lived services such as the store and its write lock.

import { ManagedRuntime } from 'effect';
import { Store } from './store.ts';

export type AppServices = Store;

export const runtime = ManagedRuntime.make(Store.layer);
