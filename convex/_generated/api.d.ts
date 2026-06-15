/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS GENERATED AUTOMATICALLY by `npx convex dev` / `npx convex codegen`.
 * Committed so the project typechecks without a Convex login. Do not edit by hand.
 */
import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';
import type * as cards from '../cards.js';
import type * as seed from '../seed.js';
import type * as seedData from '../seedData.js';

declare const fullApi: ApiFromModules<{
	cards: typeof cards;
	seed: typeof seed;
	seedData: typeof seedData;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;
