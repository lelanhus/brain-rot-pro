import { slugToDisplay } from './slug';

type AddInterest = (args: { deviceId: string; slug: string; title: string }) => unknown;
type RemoveInterest = (args: { deviceId: string; slug: string }) => unknown;

/**
 * Follow ⇄ unfollow a topic from a chip/row. Removes when already followed,
 * otherwise adds with a display-formatted title. No-op without a device. Shared
 * by the search and onboarding pickers so the follow rule lives in one place.
 */
export function toggleInterest(
	followed: ReadonlySet<string>,
	slug: string,
	title: string,
	deps: { deviceId: string; add: AddInterest; remove: RemoveInterest }
): void {
	if (deps.deviceId === '') return;
	if (followed.has(slug)) void deps.remove({ deviceId: deps.deviceId, slug });
	else void deps.add({ deviceId: deps.deviceId, slug, title: slugToDisplay(title) });
}
