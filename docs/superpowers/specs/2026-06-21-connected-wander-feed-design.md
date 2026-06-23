# Connected-Wander Feed — Design Spec

**Date:** 2026-06-21 · **Status:** Self-approved (autonomous) · **Vision:** addictive, magical, fun learning — "a better algorithm than TikTok"

## North star

Turn the feed from "a stream of independent facts" into a **navigable lattice of ideas** you _wander_ through — where the dopamine is the surprising hop ("wait, _these_ connect?"), and the **path is personalized per user, learned from how they respond.** TikTok's magic is purely _what it shows next_; we apply that to knowledge, optimizing the _thread of a session_, not time-on-app.

## The atomic model

The node is a **fact** (a card), not an article (an article is a small cluster of facts). Edges = adjacency between facts (shared concept / embedding proximity / — later — Wikipedia links). Wandering = walking that graph, with each user's hop choices weighted by their learned taste and steered by their live engagement.

## Three components (built in this order)

### 1. Depth — real nodes (many facts per article)

Today `generateFromArticle` makes **one** card per article; a rich topic is flattened to a single surprise. Change generation to produce **up to `TARGET_CARDS_PER_TOPIC` (=3)** distinct facts per topic.

- **YAGNI approach:** `generateForTopic` loops the existing `generateFromArticle` up to TARGET, passing the topic's already-generated hooks as `avoidHooks` so each pass surfaces a _new_ angle; the existing 0.88-cosine dedup drops repeats. `cardCount` increments per published fact.
- `needingCards` stays `cardCount == 0` (a fresh topic gets its whole batch in one `generateForTopic` call); partial topics (errored mid-batch) are acceptable for v1.
- Reuses the whole validate/dedup/publish pipeline; the only `generate.ts` change is an optional `avoidHooks` prompt hint.

### 2. Graded per-user dwell signal — better learning input

`visibleMs` is **already stored** on every `card_complete`/`card_skip` event; we currently collapse it to a flat `EVENT_DELTA` (complete +1, skip −0.5). Use the magnitude, **normalized to each user's own baseline** (reading speeds differ):

- `profile.recompute` computes the user's average complete-dwell (`userAvgDwell`).
- Pure `engagementWeight(type, visibleMs, userAvgDwell)`: for `card_complete`, scale the +1 by `clamp(visibleMs / userAvgDwell, 0.5, 2.5)` — lingered 2× your norm → strong positive; barely-completed → weak. Explicit events (save/expand/not_interested) unchanged. `card_skip` stays −0.5 (soft; dwell is noisy).
- `accumulateWeights` + `buildTasteVector` use this graded weight. Length-awareness already exists (the dwell _threshold_ scales with body length); this adds _magnitude_. Dwell stays a **soft** signal that complements, never replaces, the explicit ones.

### 3. Personalized connected-next — the wander (hero)

The feed ranks by `scoreByTaste` (taste cosine + wildcard + focus + interest boost) but ignores _what you just engaged with_. Add **threading**: bias the next cards toward neighbors of your **live thread**, weighted by your taste.

- Client passes `threadFromCardId` (the most-recent positively-engaged card — completed/saved) to the live feed query.
- `feed.unseen` loads that card's embedding/concepts and `scoreByTaste` adds a `THREAD_WEIGHT · cosine(candidate.embedding, thread.embedding)` term (concept-overlap fallback when embeddings absent). Taste still dominates (long-term you); the thread term steers the _hop_ (where you are now). Tuned to nudge, like `INTEREST_BOOST`.
- Because the existing engage→`recompute` loop keeps running, the hops you take re-tune your taste vector → tomorrow's paths bend toward what worked. **Personalized paths fall out of the loop we already have** — no new model.
- To avoid jarring full-feed reshuffles, `threadFromCardId` updates at a coarse cadence (on card _completion_, not every scroll tick).

## Deferred (YAGNI — add only as needed, on real data)

Generated "X connects to Y" connection cards (`hidden_connection`) with two-source grounding; an explicit graph store; Wikipedia link-graph edges; the per-user **surprise-tolerance dial** (learn near-vs-far hop preference → tune relevance/novelty blend per user). All real, all later.

## Testing

- **Depth:** pure — `avoidHooks` threads through the prompt; `convex-test` — `generateForTopic` fills a topic toward TARGET (stubbed generate), increments cardCount, stops at TARGET.
- **Graded dwell:** pure — `engagementWeight` grades by dwell ratio, clamps, leaves explicit events flat; `accumulateWeights`/`buildTasteVector` reflect magnitude; `convex-test` recompute computes userAvgDwell.
- **Connected-next:** pure — `scoreByTaste` adds the thread term in both branches, guarded/cold-start-safe; `convex-test` `feed.unseen` ranks a thread-neighbor above an equally-taste-scored non-neighbor; client wires `threadFromCardId`.
- **Browser:** engage a card → the next cards visibly hop toward related ideas (a wander), and lingering longer shifts what surfaces next.

## Risks

- Depth quality/cost: N AI calls per topic; mitigated by TARGET=3 + avoidHooks + dedup. Tune/switch to single-call-array if cost or quality demands.
- Dwell noise (idle tabs): per-user normalization + clamp + soft weight + skip stays flat.
- Threading jarring: coarse update cadence + nudge-weight; can move to inject-on-engagement if reshuffle feels off.
- The algorithm can only be truly tuned on real engagement — ship the loop, then turn dials.
