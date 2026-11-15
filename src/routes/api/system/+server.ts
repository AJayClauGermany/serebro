import { json } from '@sveltejs/kit';
import { systemStatus } from '#lib/server/system.ts';

export const GET = () => json(systemStatus());
