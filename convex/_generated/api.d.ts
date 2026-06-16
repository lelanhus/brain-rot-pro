/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiKey from "../aiKey.js";
import type * as cards from "../cards.js";
import type * as embedLogic from "../embedLogic.js";
import type * as embeddings from "../embeddings.js";
import type * as embeddingsDb from "../embeddingsDb.js";
import type * as events from "../events.js";
import type * as feed from "../feed.js";
import type * as generate from "../generate.js";
import type * as generateDb from "../generateDb.js";
import type * as generateLogic from "../generateLogic.js";
import type * as imageLicense from "../imageLicense.js";
import type * as ingest from "../ingest.js";
import type * as ingestUtils from "../ingestUtils.js";
import type * as metrics from "../metrics.js";
import type * as profile from "../profile.js";
import type * as profileLogic from "../profileLogic.js";
import type * as review from "../review.js";
import type * as saved from "../saved.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as stats from "../stats.js";
import type * as streakLogic from "../streakLogic.js";
import type * as wikidataLogic from "../wikidataLogic.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiKey: typeof aiKey;
  cards: typeof cards;
  embedLogic: typeof embedLogic;
  embeddings: typeof embeddings;
  embeddingsDb: typeof embeddingsDb;
  events: typeof events;
  feed: typeof feed;
  generate: typeof generate;
  generateDb: typeof generateDb;
  generateLogic: typeof generateLogic;
  imageLicense: typeof imageLicense;
  ingest: typeof ingest;
  ingestUtils: typeof ingestUtils;
  metrics: typeof metrics;
  profile: typeof profile;
  profileLogic: typeof profileLogic;
  review: typeof review;
  saved: typeof saved;
  seed: typeof seed;
  seedData: typeof seedData;
  stats: typeof stats;
  streakLogic: typeof streakLogic;
  wikidataLogic: typeof wikidataLogic;
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
