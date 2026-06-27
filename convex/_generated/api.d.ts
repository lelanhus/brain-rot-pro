/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as accountMerge from "../accountMerge.js";
import type * as accounts from "../accounts.js";
import type * as accountsLogic from "../accountsLogic.js";
import type * as admin from "../admin.js";
import type * as adminAuth from "../adminAuth.js";
import type * as adminLogic from "../adminLogic.js";
import type * as affiliate from "../affiliate.js";
import type * as affiliateLogic from "../affiliateLogic.js";
import type * as aiKey from "../aiKey.js";
import type * as auth from "../auth.js";
import type * as cards from "../cards.js";
import type * as crons from "../crons.js";
import type * as curation from "../curation.js";
import type * as deviceIdentity from "../deviceIdentity.js";
import type * as discovery from "../discovery.js";
import type * as discoveryLogic from "../discoveryLogic.js";
import type * as dumpParse from "../dumpParse.js";
import type * as embedLogic from "../embedLogic.js";
import type * as embeddings from "../embeddings.js";
import type * as embeddingsDb from "../embeddingsDb.js";
import type * as events from "../events.js";
import type * as feed from "../feed.js";
import type * as generate from "../generate.js";
import type * as generateDb from "../generateDb.js";
import type * as generateLogic from "../generateLogic.js";
import type * as generationPipeline from "../generationPipeline.js";
import type * as http from "../http.js";
import type * as imageCandidates from "../imageCandidates.js";
import type * as imageLicense from "../imageLicense.js";
import type * as imageScrim from "../imageScrim.js";
import type * as ingest from "../ingest.js";
import type * as ingestUtils from "../ingestUtils.js";
import type * as interests from "../interests.js";
import type * as legibility from "../legibility.js";
import type * as profile from "../profile.js";
import type * as profileLogic from "../profileLogic.js";
import type * as rateLimits from "../rateLimits.js";
import type * as safety from "../safety.js";
import type * as safetyLogic from "../safetyLogic.js";
import type * as saved from "../saved.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as stats from "../stats.js";
import type * as streakLogic from "../streakLogic.js";
import type * as sync from "../sync.js";
import type * as syncLogic from "../syncLogic.js";
import type * as topics from "../topics.js";
import type * as topicsLogic from "../topicsLogic.js";
import type * as wikidataLogic from "../wikidataLogic.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  accountMerge: typeof accountMerge;
  accounts: typeof accounts;
  accountsLogic: typeof accountsLogic;
  admin: typeof admin;
  adminAuth: typeof adminAuth;
  adminLogic: typeof adminLogic;
  affiliate: typeof affiliate;
  affiliateLogic: typeof affiliateLogic;
  aiKey: typeof aiKey;
  auth: typeof auth;
  cards: typeof cards;
  crons: typeof crons;
  curation: typeof curation;
  deviceIdentity: typeof deviceIdentity;
  discovery: typeof discovery;
  discoveryLogic: typeof discoveryLogic;
  dumpParse: typeof dumpParse;
  embedLogic: typeof embedLogic;
  embeddings: typeof embeddings;
  embeddingsDb: typeof embeddingsDb;
  events: typeof events;
  feed: typeof feed;
  generate: typeof generate;
  generateDb: typeof generateDb;
  generateLogic: typeof generateLogic;
  generationPipeline: typeof generationPipeline;
  http: typeof http;
  imageCandidates: typeof imageCandidates;
  imageLicense: typeof imageLicense;
  imageScrim: typeof imageScrim;
  ingest: typeof ingest;
  ingestUtils: typeof ingestUtils;
  interests: typeof interests;
  legibility: typeof legibility;
  profile: typeof profile;
  profileLogic: typeof profileLogic;
  rateLimits: typeof rateLimits;
  safety: typeof safety;
  safetyLogic: typeof safetyLogic;
  saved: typeof saved;
  seed: typeof seed;
  seedData: typeof seedData;
  stats: typeof stats;
  streakLogic: typeof streakLogic;
  sync: typeof sync;
  syncLogic: typeof syncLogic;
  topics: typeof topics;
  topicsLogic: typeof topicsLogic;
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

export declare const components: {
  generationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"generationPool">;
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
