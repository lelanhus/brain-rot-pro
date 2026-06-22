import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

/** Follow a catalog topic. Idempotent per device+slug; schedules generation so the topic has a card. */
export const add = mutation({
	args: { deviceId: v.string(), slug: v.string(), title: v.string() },
	handler: async (ctx, { deviceId, slug, title }) => {
		const existing = await ctx.db
			.query('interests')
			.withIndex('by_device_slug', (q) => q.eq('deviceId', deviceId).eq('slug', slug))
			.unique();
		if (existing !== null) return;
		await ctx.db.insert('interests', { deviceId, slug, title, source: 'explicit', createdAt: Date.now() });
		await ctx.scheduler.runAfter(0, internal.generationPipeline.generateForTopic, { slug });
		await ctx.scheduler.runAfter(0, internal.discovery.discoverFor, { deviceId, slug, title });
	}
});

export const remove = mutation({
	args: { deviceId: v.string(), slug: v.string() },
	handler: async (ctx, { deviceId, slug }) => {
		const row = await ctx.db
			.query('interests')
			.withIndex('by_device_slug', (q) => q.eq('deviceId', deviceId).eq('slug', slug))
			.unique();
		if (row !== null) await ctx.db.delete(row._id);
	}
});

export const list = query({
	args: { deviceId: v.string() },
	handler: async (ctx, { deviceId }) =>
		await ctx.db
			.query('interests')
			.withIndex('by_device', (q) => q.eq('deviceId', deviceId))
			.order('desc')
			.collect()
});

/** Add a discovered interest (from auto-discovery). Dedupes; schedules generation; does NOT trigger further discovery. */
export const addDiscovered = internalMutation({
	args: { deviceId: v.string(), slug: v.string(), title: v.string() },
	handler: async (ctx, { deviceId, slug, title }) => {
		const existing = await ctx.db
			.query('interests')
			.withIndex('by_device_slug', (q) => q.eq('deviceId', deviceId).eq('slug', slug))
			.unique();
		if (existing !== null) return;
		await ctx.db.insert('interests', { deviceId, slug, title, source: 'discovered', createdAt: Date.now() });
		await ctx.scheduler.runAfter(0, internal.generationPipeline.generateForTopic, { slug });
	}
});
