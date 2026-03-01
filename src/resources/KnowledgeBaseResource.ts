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

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

export class KnowledgeBaseResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /KnowledgeBase/<id> — return a single KB.
	 * GET /KnowledgeBase/ — list all KBs.
	 * PUBLIC — no auth required.
	 */
	async get() {
		const id = this.getId();
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
	 * AUTH REQUIRED: team role only.
	 */
	async post(_target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		if (!data?.id || !data?.name) {
			return { status: 400, data: { error: 'id and name are required' } };
		}

		try {
			return await createKnowledgeBase({
				...data,
				createdBy: user.username || user.id || 'unknown',
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
	 * AUTH REQUIRED: team role only.
	 */
	async put(_target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Knowledge base ID required' } };
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
	 * AUTH REQUIRED: team role only.
	 */
	async delete() {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const id = this.getId();
		if (!id) {
			return { status: 400, data: { error: 'Knowledge base ID required' } };
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
