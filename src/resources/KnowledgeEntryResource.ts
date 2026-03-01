/**
 * Knowledge Entry Resource
 *
 * REST endpoint for knowledge base entries.
 * GET is public; POST, PUT, DELETE require authentication.
 * All operations require kbId query parameter for tenant scoping.
 *
 * Routes:
 *   GET  /Knowledge/<id>?kbId=..      — return single entry
 *   GET  /Knowledge/?kbId=..&query=.. — search entries
 *   POST /Knowledge/?kbId=..          — create new entry (auth required)
 *   PUT  /Knowledge/<id>?kbId=..      — update entry (auth required)
 *   DELETE /Knowledge/<id>?kbId=..    — deprecate entry (team role required)
 */

import { createEntry, getEntry, updateEntry, deprecateEntry, stripEmbedding } from '../core/entries.ts';
import { search, listEntries } from '../core/search.ts';
import type { SearchParams } from '../types.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

/**
 * Extract kbId from query params (target).
 */
function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class KnowledgeEntryResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /Knowledge/<id>?kbId=.. — return a single entry by ID.
	 * GET /Knowledge/?kbId=..&query=... — search the knowledge base.
	 * PUBLIC — no auth required. kbId required.
	 */
	async get(target?: any) {
		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const id = this.getId();
		if (id) {
			const entry = await getEntry(String(id));
			if (!entry || entry.kbId !== kbId) {
				return { status: 404, data: { error: 'Entry not found' } };
			}
			return stripEmbedding(entry);
		}

		// Search mode: extract query params from target
		const query = target?.get?.('query') || target?.query;
		const tagsParam = target?.get?.('tags') || target?.tags;
		const limitParam = target?.get?.('limit') || target?.limit;
		const tags = tagsParam ? String(tagsParam).split(',') : undefined;
		const limit = limitParam ? parseInt(String(limitParam), 10) : undefined;

		// Browse mode: query=* or no query — list entries without scoring
		if (!query || String(query) === '*') {
			return listEntries(kbId, tags, limit);
		}

		const contextParam = target?.get?.('context') || target?.context;
		const modeParam = target?.get?.('mode') || target?.mode;

		let context;
		if (contextParam) {
			try {
				context = typeof contextParam === 'string' ? JSON.parse(contextParam) : contextParam;
			} catch {
				return {
					status: 400,
					data: { error: 'Invalid context parameter: must be valid JSON' },
				};
			}
		}

		const params: SearchParams = {
			kbId,
			query: String(query),
			tags,
			limit,
			context,
			mode: modeParam as SearchParams['mode'] | undefined,
		};

		const results = await search(params);
		return results.map(stripEmbedding);
	}

	/**
	 * POST /Knowledge/?kbId=.. — create a new knowledge entry.
	 * AUTH REQUIRED. AI agents have their confidence forced to "ai-generated".
	 */
	async post(target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}

		const kbId = extractKbId(target) || data?.kbId;
		if (!kbId) {
			return { status: 400, data: { error: 'kbId is required' } };
		}

		if (!data?.title || !data?.content) {
			return { status: 400, data: { error: 'title and content are required' } };
		}
		if (data.title.length > 500 || data.content.length > 100_000) {
			return {
				status: 400,
				data: { error: 'Title max 500 chars, content max 100,000 chars' },
			};
		}

		// Force ai-generated confidence for ai-agent role
		if (user.role === 'ai-agent') {
			data.confidence = 'ai-generated';
		}
		if (!data.addedBy) {
			data.addedBy = user.username || user.id || 'unknown';
		}

		return createEntry({ ...data, kbId });
	}

	/**
	 * PUT /Knowledge/<id>?kbId=.. — create or update an entry.
	 * AUTH REQUIRED. AI agents have their confidence forced to "ai-generated".
	 */
	async put(target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}

		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Entry ID required' } };
		}

		const kbId = extractKbId(target) || data?.kbId;
		if (!kbId) {
			return { status: 400, data: { error: 'kbId is required' } };
		}

		if (user.role === 'ai-agent') {
			data.confidence = 'ai-generated';
		}
		if (!data.addedBy) {
			data.addedBy = user.username || user.id || 'unknown';
		}

		// Upsert: try update first, create if not found
		try {
			const existing = await getEntry(String(id));
			if (existing && existing.kbId !== kbId) {
				return { status: 404, data: { error: 'Entry not found' } };
			}
			return await updateEntry(String(id), data);
		} catch (error) {
			if ((error as Error).message.includes('not found')) {
				// Entry doesn't exist — create if full data provided, otherwise 404
				if (!data.title || !data.content) {
					return { status: 404, data: { error: 'Entry not found' } };
				}
				return createEntry({ ...data, id: String(id), kbId });
			}
			throw error;
		}
	}

	/**
	 * DELETE /Knowledge/<id>?kbId=.. — deprecate an entry (soft delete).
	 * AUTH REQUIRED: team role only.
	 */
	async delete(target?: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Entry ID required' } };
		}

		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		// Verify entry belongs to this KB
		const existing = await getEntry(String(id));
		if (!existing || existing.kbId !== kbId) {
			return { status: 404, data: { error: 'Entry not found' } };
		}

		try {
			await deprecateEntry(String(id));
			return true;
		} catch (error) {
			if ((error as Error).message.includes('not found')) {
				return { status: 404, data: { error: (error as Error).message } };
			}
			throw error;
		}
	}
}
