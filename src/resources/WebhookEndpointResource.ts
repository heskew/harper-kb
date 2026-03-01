/**
 * WebhookEndpoint Resource
 *
 * REST endpoint for managing per-KB webhook endpoints.
 * All operations require team role and kbId for tenant scoping.
 *
 * Routes:
 *   GET    /WebhookEndpoint/?kbId=..      — list endpoints for a KB (team role)
 *   POST   /WebhookEndpoint/?kbId=..      — create endpoint, returns URL + secret once (team role)
 *   DELETE /WebhookEndpoint/<id>?kbId=..   — delete an endpoint (team role)
 */

import { createWebhookEndpoint, listWebhookEndpoints, deleteWebhookEndpoint } from '../core/webhook-endpoints.ts';

function getResourceClass(): any {
	return (globalThis as any).Resource;
}

function extractKbId(target?: any): string | null {
	return target?.get?.('kbId') || target?.kbId || null;
}

export class WebhookEndpointResource extends getResourceClass() {
	static loadAsInstance = false;

	/**
	 * GET /WebhookEndpoint/?kbId=.. — list all webhook endpoints for a KB.
	 * AUTH REQUIRED: team role only.
	 */
	async get(target?: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		return listWebhookEndpoints(kbId);
	}

	/**
	 * POST /WebhookEndpoint/?kbId=.. — create a new webhook endpoint.
	 * AUTH REQUIRED: team role only.
	 *
	 * Body: { provider: "github", label?: "owner/repo" }
	 *
	 * Returns the endpoint record plus the plaintext secret and full webhook URL.
	 * The secret is shown only once — it is never stored or retrievable again.
	 */
	async post(target: any, data: any) {
		const user = this.getCurrentUser();
		if (!user) {
			return { status: 401, data: { error: 'Authentication required' } };
		}
		if (user.role !== 'team') {
			return { status: 403, data: { error: 'Team role required' } };
		}

		const kbId = extractKbId(target) || data?.kbId;
		if (!kbId) {
			return { status: 400, data: { error: 'kbId is required' } };
		}

		if (!data?.provider) {
			return { status: 400, data: { error: 'provider is required' } };
		}

		const validProviders = ['github'];
		if (!validProviders.includes(data.provider)) {
			return {
				status: 400,
				data: { error: `provider must be one of: ${validProviders.join(', ')}` },
			};
		}

		try {
			const { endpoint, secret } = await createWebhookEndpoint(
				kbId,
				data.provider,
				data.label,
				user.username || user.id
			);

			return {
				...endpoint,
				secret,
				webhookUrl: `/webhooks/${kbId}/${data.provider}/${secret}`,
			};
		} catch (error) {
			const message = (error as Error).message;
			if (message.includes('not found')) {
				return { status: 404, data: { error: message } };
			}
			throw error;
		}
	}

	/**
	 * DELETE /WebhookEndpoint/<id>?kbId=.. — delete a webhook endpoint.
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
			return { status: 400, data: { error: 'Webhook endpoint ID required' } };
		}

		const kbId = extractKbId(target);
		if (!kbId) {
			return { status: 400, data: { error: 'kbId query parameter is required' } };
		}

		try {
			await deleteWebhookEndpoint(String(id), kbId);
			return true;
		} catch {
			return { status: 404, data: { error: 'Webhook endpoint not found' } };
		}
	}
}
