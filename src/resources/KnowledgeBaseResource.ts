/**
 * Knowledge Base Resource
 *
 * REST endpoint for managing knowledge base tenants.
 * GET is public; POST, PUT, DELETE require team role.
 *
 * Routes:
 *   GET  /KnowledgeBase/         — list all knowledge bases
 *   GET  /KnowledgeBase/<id>     — get a single knowledge base
 *   POST /KnowledgeBase/         — create a new knowledge base (team role)
 *   PUT  /KnowledgeBase/<id>     — update a knowledge base (team role)
 *   DELETE /KnowledgeBase/<id>   — delete a knowledge base (team role)
 */

import {
	createKnowledgeBase,
	getKnowledgeBase,
	updateKnowledgeBase,
	deleteKnowledgeBase,
	listKnowledgeBases,
} from '../core/knowledge-base.ts';
import { checkAccess } from '../hooks.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

export class KnowledgeBaseResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /KnowledgeBase/<id> — return a single KB.
	 * GET /KnowledgeBase/ — list all KBs.
	 * Default: public. Hook can restrict.
	 */
	async get() {
		const id = this.getId();

		const accessResult = await checkAccess({
			user: this.getCurrentUser(),
			kbId: id ? String(id) : null,
			resource: 'KnowledgeBase',
			operation: 'read',
			channel: 'rest',
		});
		if (accessResult && !accessResult.allow) {
			const user = this.getCurrentUser();
			return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
		}

		if (id) {
			const kb = await getKnowledgeBase(String(id));
			if (!kb) {
				return { status: 404, data: { error: 'Knowledge base not found' } };
			}
			return kb;
		}

		return listKnowledgeBases();
	}

	/**
	 * POST /KnowledgeBase/ — create a new knowledge base.
	 * Default: team role required. Hook can override.
	 */
	async post(_target: any, data: any) {
		const user = this.getCurrentUser();

		const accessResult = await checkAccess({
			user,
			kbId: data?.id || null,
			resource: 'KnowledgeBase',
			operation: 'write',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'team') {
				return { status: 403, data: { error: 'Team role required' } };
			}
		}

		if (!data?.id || !data?.name) {
			return { status: 400, data: { error: 'id and name are required' } };
		}

		try {
			return await createKnowledgeBase({
				...data,
				createdBy: user?.username || user?.id || 'unknown',
			});
		} catch (error) {
			if ((error as Error).message.includes('already exists')) {
				return { status: 409, data: { error: (error as Error).message } };
			}
			throw error;
		}
	}

	/**
	 * PUT /KnowledgeBase/<id> — update a knowledge base.
	 * Default: team role required. Hook can override.
	 */
	async put(_target: any, data: any) {
		const user = this.getCurrentUser();
		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Knowledge base ID required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId: String(id),
			resource: 'KnowledgeBase',
			operation: 'write',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'team') {
				return { status: 403, data: { error: 'Team role required' } };
			}
		}

		try {
			return await updateKnowledgeBase(String(id), data);
		} catch (error) {
			if ((error as Error).message.includes('not found')) {
				return { status: 404, data: { error: (error as Error).message } };
			}
			throw error;
		}
	}

	/**
	 * DELETE /KnowledgeBase/<id> — delete a knowledge base.
	 * Default: team role required. Hook can override.
	 */
	async delete() {
		const user = this.getCurrentUser();
		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Knowledge base ID required' } };
		}

		const accessResult = await checkAccess({
			user,
			kbId: String(id),
			resource: 'KnowledgeBase',
			operation: 'write',
			channel: 'rest',
		});
		if (accessResult) {
			if (!accessResult.allow) {
				return { status: user ? 403 : 401, data: { error: accessResult.reason || 'Access denied' } };
			}
		} else {
			if (!user) {
				return { status: 401, data: { error: 'Authentication required' } };
			}
			if (user.role !== 'team') {
				return { status: 403, data: { error: 'Team role required' } };
			}
		}

		try {
			await deleteKnowledgeBase(String(id));
			return true;
		} catch (error) {
			if ((error as Error).message.includes('not found')) {
				return { status: 404, data: { error: (error as Error).message } };
			}
			throw error;
		}
	}
}
