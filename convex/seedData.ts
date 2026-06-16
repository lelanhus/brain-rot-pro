/**
 * Phase-0 seed cards — a curated starter set to test the make-or-break question:
 * "is this fun to scroll?" (acceptance-criteria.md, Phase 0).
 *
 * These are hand-authored from well-established, verifiable facts so the spike
 * isn't blocked on the generation pipeline. Each carries real provenance
 * (source article + URL + the grounding span). `revisionId` is null because
 * these were not machine-fetched; the generation pipeline MUST populate it.
 * Images are intentionally omitted (no unverified license data); generated cards
 * get fail-closed Commons images via ingestion (`imageLicense.ts`).
 *
 * Expanding toward the ~150–200 cards the real usability test wants is a
 * follow-on (ideally the first output of the generation pipeline).
 */

import type { Infer } from 'convex/values';
import type { cardFormat, sourceValidator } from './schema';

export type SeedCard = {
	hook: string;
	body: string;
	whyItMatters?: string;
	format: Infer<typeof cardFormat>;
	conceptTags: string[];
	source: Infer<typeof sourceValidator>;
};

export const seedCards: SeedCard[] = [
	{
		hook: 'Oxford University is older than the Aztec Empire.',
		body: 'Teaching existed at Oxford as far back as 1096, and the university grew rapidly after 1167. Tenochtitlan, the Aztec capital, was not founded until 1325 — meaning students were already studying at Oxford more than two centuries before the Aztec Empire began.',
		whyItMatters:
			'It scrambles the mental timeline that files "medieval Europe" and "ancient Americas" into the wrong order.',
		format: 'timeline_shock',
		conceptTags: ['Oxford', 'Aztecs', 'history', 'universities'],
		source: {
			articleTitle: 'University of Oxford',
			articleUrl: 'https://en.wikipedia.org/wiki/University_of_Oxford',
			revisionId: null,
			sourceSpan:
				'There is evidence of teaching at Oxford as early as 1096, making it the oldest university in the English-speaking world.'
		}
	},
	{
		hook: 'Napoleon was probably not unusually short.',
		body: 'His recorded height was about 1.68 m (5 ft 6 in) — average for a Frenchman of his time. The "tiny tyrant" image likely came from confusion between French and English inches, British propaganda, and the nickname "le petit caporal." He was also often seen beside his taller Imperial Guard.',
		whyItMatters: 'A clean example of how political mockery hardens into "fact."',
		format: 'myth_buster',
		conceptTags: ['Napoleon', 'propaganda', 'measurement', 'France'],
		source: {
			articleTitle: 'Napoleon',
			articleUrl: 'https://en.wikipedia.org/wiki/Napoleon',
			revisionId: null,
			sourceSpan:
				"Napoleon's height was 1.68 metres, average for the period; the misconception that he was short stems partly from differences between French and British units of measurement."
		}
	},
	{
		hook: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
		body: 'The Great Pyramid of Giza was completed around 2560 BC. Cleopatra died in 30 BC — about 2,500 years later. The Apollo 11 Moon landing was in 1969 AD, roughly 2,000 years after Cleopatra. She was nearer to the spaceflight era than to the pyramids that already felt ancient in her own lifetime.',
		whyItMatters: 'Deep time is so vast that "ancient Egypt" contains its own ancient history.',
		format: 'timeline_shock',
		conceptTags: ['Cleopatra', 'Great Pyramid', 'ancient Egypt', 'deep time'],
		source: {
			articleTitle: 'Cleopatra',
			articleUrl: 'https://en.wikipedia.org/wiki/Cleopatra',
			revisionId: null,
			sourceSpan:
				'Cleopatra died in 30 BC; the Great Pyramid of Giza was built around 2560 BC, while the Moon landing occurred in 1969 AD.'
		}
	},
	{
		hook: 'Roman concrete could set underwater — and may heal its own cracks.',
		body: 'Romans mixed volcanic ash (pozzolana) with lime, producing concrete that hardened even in seawater and grew stronger over time. Recent research suggests lumps of lime left in the mix act as a repair kit: when cracks let water in, the lime dissolves and recrystallizes, sealing the gap.',
		whyItMatters:
			'A 2,000-year-old material is teaching modern engineers about self-healing concrete.',
		format: 'object_story',
		conceptTags: ['Roman concrete', 'engineering', 'materials', 'Rome'],
		source: {
			articleTitle: 'Roman concrete',
			articleUrl: 'https://en.wikipedia.org/wiki/Roman_concrete',
			revisionId: null,
			sourceSpan:
				'Roman concrete made with volcanic ash could set underwater, and studies indicate lime clasts gave it a self-healing capacity.'
		}
	},
	{
		hook: 'The word "quarantine" literally means "forty days."',
		body: 'During the Black Death, ships arriving in Venetian-controlled ports had to sit at anchor before anyone could land. The waiting period became forty days — "quaranta giorni" in Italian — which gave us the word quarantine. An earlier thirty-day version was called a "trentino."',
		whyItMatters:
			'A public-health practice from the 1300s is still encoded in the words we used in 2020.',
		format: 'origin_story',
		conceptTags: ['quarantine', 'Black Death', 'etymology', 'Venice'],
		source: {
			articleTitle: 'Quarantine',
			articleUrl: 'https://en.wikipedia.org/wiki/Quarantine',
			revisionId: null,
			sourceSpan:
				'The word quarantine originates from quaranta giorni, Italian for "forty days," the period ships were isolated during the Black Death.'
		}
	},
	{
		hook: 'Ada Lovelace described a computer program a century before computers existed.',
		body: "In the 1840s, Ada Lovelace translated a paper on Charles Babbage's proposed Analytical Engine and added her own notes — longer than the original. They included a step-by-step method for the machine to compute Bernoulli numbers, often called the first published algorithm intended for a machine.",
		whyItMatters:
			'She saw that such a machine could manipulate symbols, not just numbers — the conceptual seed of computing.',
		format: 'mini_biography',
		conceptTags: ['Ada Lovelace', 'computing', 'Analytical Engine', 'algorithms'],
		source: {
			articleTitle: 'Ada Lovelace',
			articleUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
			revisionId: null,
			sourceSpan:
				"Lovelace's notes on the Analytical Engine include what is recognised as the first algorithm intended to be carried out by a machine."
		}
	},
	{
		hook: 'Honey can stay edible for thousands of years.',
		body: "Archaeologists have found pots of honey in ancient Egyptian tombs that were still preserved after millennia. Honey's low moisture and high acidity make it inhospitable to bacteria, and bees add an enzyme that produces hydrogen peroxide. Sealed and kept dry, honey essentially does not spoil.",
		whyItMatters: 'It is one of the only foods that effectively never goes bad.',
		format: 'surprise_fact',
		conceptTags: ['honey', 'food science', 'preservation', 'bees'],
		source: {
			articleTitle: 'Honey',
			articleUrl: 'https://en.wikipedia.org/wiki/Honey',
			revisionId: null,
			sourceSpan:
				'Because of its low water content and acidity, honey does not readily spoil, and edible honey has been found in ancient tombs.'
		}
	},
	{
		hook: 'Sharks are older than trees.',
		body: 'Sharks have existed for roughly 450 million years, surviving multiple mass extinctions. The first true trees, with wood and deep roots, appeared around 350–390 million years ago. Sharks were already patrolling the oceans before forests covered the land.',
		whyItMatters:
			'Some "primitive" animals predate features of life we assume are ancient and basic.',
		format: 'timeline_shock',
		conceptTags: ['sharks', 'trees', 'evolution', 'deep time'],
		source: {
			articleTitle: 'Shark',
			articleUrl: 'https://en.wikipedia.org/wiki/Shark',
			revisionId: null,
			sourceSpan:
				'Sharks have existed for about 450 million years, predating the earliest trees, which appeared roughly 390 million years ago.'
		}
	},
	{
		hook: 'A volcano in Indonesia helped create the Frankenstein monster.',
		body: "The 1815 eruption of Mount Tambora threw so much ash into the atmosphere that 1816 became the 'Year Without a Summer.' Trapped indoors by cold, gloomy weather at Lake Geneva, Mary Shelley and her companions held a ghost-story contest. Her entry became Frankenstein.",
		whyItMatters: 'A geological catastrophe rippled, by chance, into the birth of science fiction.',
		format: 'hidden_connection',
		conceptTags: ['Mount Tambora', 'Frankenstein', 'Mary Shelley', 'climate'],
		source: {
			articleTitle: 'Year Without a Summer',
			articleUrl: 'https://en.wikipedia.org/wiki/Year_Without_a_Summer',
			revisionId: null,
			sourceSpan:
				"The 1815 eruption of Mount Tambora caused the 1816 'Year Without a Summer,' whose dismal weather kept Mary Shelley indoors as she began Frankenstein."
		}
	},
	{
		hook: 'The printing press helped split the Christian church.',
		body: "When Martin Luther posted his 95 Theses in 1517, printers copied and sold them across the German lands within weeks — far faster than the Church could respond. Gutenberg's movable type turned a local academic dispute into an unstoppable, mass-distributed movement: the Reformation.",
		whyItMatters:
			'A communication technology reshaped religion and politics, much like later networks would.',
		format: 'cause_effect',
		conceptTags: ['printing press', 'Reformation', 'Martin Luther', 'media'],
		source: {
			articleTitle: 'Printing press',
			articleUrl: 'https://en.wikipedia.org/wiki/Printing_press',
			revisionId: null,
			sourceSpan:
				'The printing press allowed rapid, cheap reproduction of texts, helping spread the ideas of the Protestant Reformation.'
		}
	},
	{
		hook: 'Wombats produce cube-shaped poop.',
		body: 'The wombat is the only known animal that makes cubic droppings. The shape forms inside the intestine, whose walls have regions of differing elasticity that mould the contents into flat-sided cubes. The cubes resist rolling, which may help wombats stack them to mark territory.',
		whyItMatters:
			'It is a genuine biomechanics puzzle that won an Ig Nobel Prize and interests manufacturers.',
		format: 'surprise_fact',
		conceptTags: ['wombat', 'biology', 'animals', 'Australia'],
		source: {
			articleTitle: 'Wombat',
			articleUrl: 'https://en.wikipedia.org/wiki/Wombat',
			revisionId: null,
			sourceSpan:
				'Wombats are the only animals known to produce cube-shaped faeces, formed by varying elasticity in the intestinal walls.'
		}
	},
	{
		hook: 'The shortest war in history lasted about 38 minutes.',
		body: 'The Anglo-Zanzibar War of 27 August 1896 began when Britain demanded a sultan it disapproved of step down. He refused, British warships bombarded the palace, and the fighting was over in under forty minutes. By most accounts it remains the shortest recorded war.',
		whyItMatters: 'It compresses the machinery of empire into a single, almost absurd morning.',
		format: 'surprise_fact',
		conceptTags: ['Anglo-Zanzibar War', 'history', 'British Empire', 'Zanzibar'],
		source: {
			articleTitle: 'Anglo-Zanzibar War',
			articleUrl: 'https://en.wikipedia.org/wiki/Anglo-Zanzibar_War',
			revisionId: null,
			sourceSpan:
				'The Anglo-Zanzibar War of 1896 lasted around 38 to 45 minutes and is considered the shortest war in recorded history.'
		}
	},
	{
		hook: 'An octopus has three hearts and blue blood.',
		body: "Two of an octopus's hearts pump blood through the gills, while a third drives it around the body. Its blood is blue because it carries oxygen using copper-based hemocyanin instead of iron-based hemoglobin — more efficient in the cold, low-oxygen depths octopuses inhabit.",
		whyItMatters: 'It shows how differently life can solve the same problem of moving oxygen.',
		format: 'surprise_fact',
		conceptTags: ['octopus', 'biology', 'hemocyanin', 'cephalopods'],
		source: {
			articleTitle: 'Octopus',
			articleUrl: 'https://en.wikipedia.org/wiki/Octopus',
			revisionId: null,
			sourceSpan:
				'Octopuses have three hearts and blue, copper-based hemocyanin blood, two hearts pumping to the gills and one to the rest of the body.'
		}
	},
	{
		hook: 'Vikings almost certainly did not wear horned helmets.',
		body: "No horned helmet has ever been found in a Viking-age grave, and horns would be useless — even dangerous — in battle. The image was largely invented in the 19th century, popularised by costume designs for Wagner's operas about Norse myth.",
		whyItMatters: 'A familiar "historical" image is really a piece of Romantic stagecraft.',
		format: 'myth_buster',
		conceptTags: ['Vikings', 'myths', 'history', 'opera'],
		source: {
			articleTitle: 'Horned helmet',
			articleUrl: 'https://en.wikipedia.org/wiki/Horned_helmet',
			revisionId: null,
			sourceSpan:
				'There is no evidence Vikings wore horned helmets; the association arose in the 19th century, partly through Wagnerian opera costumes.'
		}
	},
	{
		hook: 'On Venus, a day is longer than a year.',
		body: 'Venus rotates so slowly that a single spin takes about 243 Earth days. But it orbits the Sun in only about 225 Earth days. So Venus completes a full trip around the Sun before it finishes one rotation — its day outlasts its year. It also spins backwards compared to most planets.',
		whyItMatters: 'It breaks the intuition that "day" must be shorter than "year."',
		format: 'surprise_fact',
		conceptTags: ['Venus', 'astronomy', 'planets', 'rotation'],
		source: {
			articleTitle: 'Venus',
			articleUrl: 'https://en.wikipedia.org/wiki/Venus',
			revisionId: null,
			sourceSpan:
				'Venus has a sidereal rotation period of about 243 Earth days, longer than its orbital period of about 225 days.'
		}
	},
	{
		hook: 'Marie Curie is the only person to win Nobel Prizes in two different sciences.',
		body: 'She won the Nobel Prize in Physics in 1903 for work on radioactivity, then the Nobel Prize in Chemistry in 1911 for discovering the elements polonium and radium. She remains the only person honoured in two distinct scientific fields, and her daughter later won one too.',
		whyItMatters:
			'A singular record in the history of science, achieved against steep barriers for women.',
		format: 'mini_biography',
		conceptTags: ['Marie Curie', 'Nobel Prize', 'radioactivity', 'chemistry'],
		source: {
			articleTitle: 'Marie Curie',
			articleUrl: 'https://en.wikipedia.org/wiki/Marie_Curie',
			revisionId: null,
			sourceSpan:
				'Marie Curie is the only person to win Nobel Prizes in two different sciences, Physics in 1903 and Chemistry in 1911.'
		}
	},
	{
		hook: 'The word "clue" comes from a ball of thread.',
		body: 'In Greek myth, Theseus found his way out of the Minotaur\'s labyrinth by unspooling a ball of thread — a "clew." Over time, "following the clew" became a metaphor for tracing a path through a mystery, and the spelling drifted to the modern "clue."',
		whyItMatters: 'A detective\'s "clue" still quietly carries a 3,000-year-old myth inside it.',
		format: 'origin_story',
		conceptTags: ['etymology', 'Theseus', 'language', 'mythology'],
		source: {
			articleTitle: 'Clue (information)',
			articleUrl: 'https://en.wikipedia.org/wiki/Clue_(information)',
			revisionId: null,
			sourceSpan:
				'The word clue derives from "clew," a ball of thread, alluding to the myth of Theseus navigating the labyrinth.'
		}
	},
	{
		hook: 'In 18th-century Europe, you could rent a pineapple.',
		body: 'Pineapples were so rare and costly in Georgian Britain that they became status symbols. Rather than eat them, the wealthy displayed them at parties — and those who could not afford to buy one could rent a pineapple for the evening as a centrepiece, returning it afterwards.',
		whyItMatters:
			'It captures how scarcity, not taste, can turn an object into pure social signalling.',
		format: 'object_story',
		conceptTags: ['pineapple', 'status symbols', 'history', 'Georgian era'],
		source: {
			articleTitle: 'Pineapple',
			articleUrl: 'https://en.wikipedia.org/wiki/Pineapple',
			revisionId: null,
			sourceSpan:
				'In 18th-century Europe pineapples were rare luxury status symbols, sometimes rented for display rather than eaten.'
		}
	}
];
