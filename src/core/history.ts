/**
 * Edit History Tracking
 *
 * Append-only audit log for knowledge entry edits.
 * Records who changed what, when, and why — with a snapshot
 * of the previous state for diffing.
 */

import crypto from 'node:crypto';
import type { KnowledgeEntry, KnowledgeEntryEdit } from '../types.ts';

/**
 * Log an edit to a knowledge entry.
 *
 * Compares the previous and updated entries to determine which fields changed,
 * then stores an edit record with the previous snapshot.
 *
 * @param entryId - ID of the entry that was edited
 * @param previous - The entry state before the edit
 * @param updated - The entry state after the edit
 * @param editedBy - Username of who made the edit
 * @param editSummary - Optional description of what changed and why
 * @returns The created edit record
 */
export async function logEdit(
	kbId: string,
	entryId: string,
	previous: KnowledgeEntry,
	updated: KnowledgeEntry,
	editedBy: string,
	editSummary?: string
): Promise<KnowledgeEntryEdit> {
	// Determine which fields actually changed
	const changedFields = detectChangedFields(previous, updated);

	// Build a snapshot of only the previous values for changed fields
	const previousSnapshot: Record<string, unknown> = {};
	for (const field of changedFields) {
		previousSnapshot[field] = (previous as unknown as Record<string, unknown>)[field];
	}

	const edit: KnowledgeEntryEdit = {
		id: crypto.randomUUID(),
		kbId,
		entryId,
		editedBy,
		editSummary,
		previousSnapshot,
		changedFields,
	};

	await databases.kb.KnowledgeEntryEdit.put(edit as unknown as Record<string, unknown>);

	return edit;
}

/**
 * Get the edit history for a knowledge entry, newest first.
 *
 * @param entryId - ID of the entry to get history for
 * @param limit - Maximum number of edits to return (default 50)
 * @returns Array of edit records, newest first
 */
export async function getHistory(entryId: string, limit = 50): Promise<KnowledgeEntryEdit[]> {
	const edits: KnowledgeEntryEdit[] = [];

	for await (const record of databases.kb.KnowledgeEntryEdit.search({
		conditions: [{ attribute: 'entryId', comparator: 'equals', value: entryId }],
		sort: { attribute: 'createdAt', descending: true },
		limit,
	})) {
		edits.push(record as unknown as KnowledgeEntryEdit);
	}

	return edits;
}

/**
 * Compare two entry states and return the list of fields that differ.
 * Ignores internal fields like embedding and updatedAt.
 */
function detectChangedFields(previous: KnowledgeEntry, updated: KnowledgeEntry): string[] {
	const trackableFields: (keyof KnowledgeEntry)[] = [
		'title',
		'content',
		'tags',
		'appliesTo',
		'source',
		'sourceUrl',
		'confidence',
		'addedBy',
		'reviewedBy',
		'metadata',
		'deprecated',
		'supersedesId',
		'supersededById',
		'siblingIds',
		'relatedIds',
	];

	const changed: string[] = [];
	for (const field of trackableFields) {
		const prev = previous[field];
		const next = updated[field];
		if (!deepEqual(prev, next)) {
			changed.push(field);
		}
	}
	return changed;
}

/**
 * Simple deep equality check for JSON-serializable values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((val, i) => deepEqual(val, b[i]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
		for (const key of keys) {
			if (!deepEqual(aObj[key], bObj[key])) return false;
		}
		return true;
	}
	return false;
}
