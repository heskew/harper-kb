/**
 * Tag Resource
 *
 * REST endpoint for knowledge base tags.
 * All operations require kbId query parameter for tenant scoping.
 *
 * Routes:
 *   GET /KnowledgeTag/?kbId=..       — list all tags (public)
 *   GET /KnowledgeTag/<id>?kbId=..   — get a single tag by name (public)
 */

import { listTags, getTag } from '../core/tags.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class TagResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /KnowledgeTag/?kbId=.. — list all tags.
	 * GET /KnowledgeTag/<id>?kbId=.. — get a single tag by name.
	 * PUBLIC — no auth required. kbId required.
	 */
	async get(target?: any) {
		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const id = this.getId();
		if (id) {
			const tag = await getTag(kbId, String(id));
			if (!tag) {
				return { status: 404, data: { error: 'Tag not found' } };
			}
			return tag;
		}

		return listTags(kbId);
	}
}
