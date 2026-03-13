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
import { checkAccess } from '../hooks.ts';

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
	 * Default: public. Hook can restrict.
	 */
	async get(target?: any) {
		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		const accessResult = await checkAccess({
			user: this.getCurrentUser(),
			kbId,
			resource: 'KnowledgeTag',
			operation: 'read',
			channel: 'rest',
		});
		if (accessResult && !accessResult.allow) {
			const user = this.getCurrentUser();
			return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
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
