import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { internal, api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.{ts,js}', '!./**/*.{test,spec}.ts', '!./**/*.d.ts']);

test('discoverFor adds up to 3 catalog-present, unfollowed related topics', async () => {
	const t = convexTest(schema, modules);
	const deviceId = 'dx';
	// Catalog has Rome (followed already), Carthage, Hannibal, Punic_Wars (candidates), but not "Random Title".
	await t.run(async (ctx) => {
		const mk = (title: string, slug: string, pageviews: number) =>
			ctx.db.insert('topics', {
				title,
				slug,
				pageviews,
				cardCount: 0,
				source: 'wikipedia-top',
				updatedAt: 1
			});
		await mk('Carthage', 'carthage', 50);
		await mk('Hannibal', 'hannibal', 90);
		await mk('Punic Wars', 'punic_wars', 30);
		await mk('Junky', 'junky', 88); // also a morelike candidate below, but evergreen:false → excluded
	});
	await t.mutation(internal.topics.setEvergreen, { slug: 'junky', evergreen: false });
	await t.mutation(internal.interests.addDiscovered, {
		deviceId,
		slug: 'hannibal',
		title: 'Hannibal'
	}); // already followed → must be skipped

	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({
						query: {
							search: [
								{ title: 'Carthage' },
								{ title: 'Hannibal' },
								{ title: 'Punic Wars' },
								{ title: 'Random Title' },
								{ title: 'Junky' }
							]
						}
					})
				}) as unknown as Response
		)
	);

	const res = await t.action(internal.discovery.discoverFor, {
		deviceId,
		slug: 'rome',
		title: 'Rome'
	});
	// Hannibal followed; Random Title not in catalog → Carthage + Punic Wars discovered (cap 3).
	expect(res.discovered).toBe(2);
	const slugs = (
		await t.withIdentity({ subject: deviceId }).query(api.interests.list, { deviceId })
	)
		.map((i) => i.slug)
		.sort();
	expect(slugs).toEqual(['carthage', 'hannibal', 'punic_wars']);
	vi.unstubAllGlobals();
});
