/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cards from "../cards.js";
import type * as events from "../events.js";
import type * as generate from "../generate.js";
import type * as generateDb from "../generateDb.js";
import type * as generateLogic from "../generateLogic.js";
import type * as ingest from "../ingest.js";
import type * as ingestUtils from "../ingestUtils.js";
import type * as metrics from "../metrics.js";
import type * as review from "../review.js";
import type * as saved from "../saved.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cards: typeof cards;
  events: typeof events;
  generate: typeof generate;
  generateDb: typeof generateDb;
  generateLogic: typeof generateLogic;
  ingest: typeof ingest;
  ingestUtils: typeof ingestUtils;
  metrics: typeof metrics;
  review: typeof review;
  saved: typeof saved;
  seed: typeof seed;
  seedData: typeof seedData;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
