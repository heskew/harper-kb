/**
 * OAuth Dynamic Client Registration (RFC 7591)
 *
 * POST /oauth/register — allows MCP clients to register themselves
 * and receive a client_id for the authorization flow.
 */

import crypto from 'node:crypto';
import type { HarperRequest } from '../types.ts';
import { readBody } from '../http-utils.ts';

/**
 * Handle POST /oauth/register
 *
 * Accepts a registration request and stores the client in OAuthClient table.
 * Public clients (no client_secret) are the default — PKCE provides security.
 */
export async function handleRegister(request: HarperRequest): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		const raw = await readBody(request);
		body = JSON.parse(raw);
	} catch {
		return errorResponse(400, 'invalid_client_metadata', 'Invalid JSON body');
	}

	// Validate redirect_uris (required)
	const redirectUris = body.redirect_uris;
	if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
		return errorResponse(400, 'invalid_redirect_uri', 'redirect_uris is required and must be a non-empty array');
	}

	// Validate each redirect URI: only localhost or https allowed
	for (const uri of redirectUris) {
		if (typeof uri !== 'string') {
			return errorResponse(400, 'invalid_redirect_uri', 'Each redirect_uri must be a string');
		}
		try {
			const parsed = new URL(uri);
			const isLocalhost =
				parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
			const isHttps = parsed.protocol === 'https:';
			if (!isLocalhost && !isHttps) {
				return errorResponse(400, 'invalid_redirect_uri', `redirect_uri must use https:// or be localhost: ${uri}`);
			}
		} catch {
			return errorResponse(400, 'invalid_redirect_uri', `Invalid redirect_uri: ${uri}`);
		}
	}

	const clientId = crypto.randomUUID();
	const clientName = typeof body.client_name === 'string' ? body.client_name : 'Unknown Client';
	const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code'];
	const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code'];

	const record = {
		id: clientId,
		clientName,
		redirectUris,
		grantTypes,
		responseTypes,
		scope: typeof body.scope === 'string' ? body.scope : 'mcp:read mcp:write',
	};

	await databases.kb.OAuthClient.put(record as unknown as Record<string, unknown>);

	logger?.info?.(`OAuth client registered: ${clientId} (${clientName})`);

	return new Response(
		JSON.stringify({
			client_id: clientId,
			client_name: clientName,
			redirect_uris: redirectUris,
			grant_types: grantTypes,
			response_types: responseTypes,
			client_id_issued_at: Math.floor(Date.now() / 1000),
		}),
		{
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

function errorResponse(status: number, error: string, description: string): Response {
	return new Response(JSON.stringify({ error, error_description: description }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
