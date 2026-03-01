/**
 * Tag Management
 *
 * Manages knowledge base tags, including listing and synchronizing
 * tag counts when entries are created, updated, or deleted.
 *
 * Tags are scoped per knowledge base. The tag ID is a composite key
 * of `${kbId}:${tagName}` to allow the same tag name across different KBs.
 */

import type { KnowledgeTag } from '../types.ts';

/**
 * Build a composite tag ID from kbId and tag name.
 */
function tagId(kbId: string, tagName: string): string {
	return `${kbId}:${tagName}`;
}

/**
 * List knowledge tags for a specific knowledge base.
 *
 * @param kbId - Knowledge base identifier
 * @param limit - Maximum number of tags to return (default 500)
 * @returns Tags from the KnowledgeTag table scoped to this KB
 */
export async function listTags(kbId: string, limit = 500): Promise<KnowledgeTag[]> {
	const results: KnowledgeTag[] = [];
	for await (const tag of databases.kb.KnowledgeTag.search({
		conditions: [{ attribute: 'kbId', comparator: 'equals', value: kbId }],
		limit,
	})) {
		results.push(tag as unknown as KnowledgeTag);
	}
	return results;
}

/**
 * Get a single tag by name within a knowledge base.
 *
 * @param kbId - Knowledge base identifier
 * @param tagName - Tag name
 * @returns The tag record, or null if not found
 */
export async function getTag(kbId: string, tagName: string): Promise<KnowledgeTag | null> {
	const tag = await databases.kb.KnowledgeTag.get(tagId(kbId, tagName));
	return tag as unknown as KnowledgeTag | null;
}

/**
 * Synchronize tag counts when entries are created, updated, or deleted.
 *
 * For tags added (in newTags but not in previousTags), increment entryCount
 * or create the tag with count 1. For tags removed (in previousTags but not
 * in newTags), decrement entryCount.
 *
 * @param kbId - Knowledge base identifier
 * @param newTags - Tags on the entry after the change
 * @param previousTags - Tags on the entry before the change (empty for new entries)
 */
export async function syncTags(kbId: string, newTags: string[], previousTags?: string[]): Promise<void> {
	const prev = new Set(previousTags || []);
	const next = new Set(newTags);

	// Tags that were added
	const added = newTags.filter((tag) => !prev.has(tag));
	// Tags that were removed
	const removed = (previousTags || []).filter((tag) => !next.has(tag));

	// Increment counts for added tags
	for (const tagName of added) {
		const id = tagId(kbId, tagName);
		const existing = await databases.kb.KnowledgeTag.get(id);
		if (existing) {
			await databases.kb.KnowledgeTag.put({
				...existing,
				id,
				kbId,
				entryCount: ((existing as unknown as KnowledgeTag).entryCount || 0) + 1,
			});
		} else {
			await databases.kb.KnowledgeTag.put({
				id,
				kbId,
				entryCount: 1,
			});
		}
	}

	// Decrement counts for removed tags
	for (const tagName of removed) {
		const id = tagId(kbId, tagName);
		const existing = await databases.kb.KnowledgeTag.get(id);
		if (existing) {
			const currentCount = (existing as unknown as KnowledgeTag).entryCount || 0;
			await databases.kb.KnowledgeTag.put({
				...existing,
				id,
				kbId,
				entryCount: Math.max(0, currentCount - 1),
			});
		}
	}
}
