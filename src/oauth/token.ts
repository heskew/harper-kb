/**
 * OAuth Token Endpoint
 *
 * POST /oauth/token — exchanges authorization codes for JWT access tokens
 * and handles refresh token grants.
 *
 * Supports:
 * - grant_type=authorization_code (with PKCE verification)
 * - grant_type=refresh_token (with token rotation)
 */

import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import type { HarperRequest } from '../types.ts';
import { readBody, parseFormBody, getBaseUrl } from '../http-utils.ts';
import { getPrivateKey, getKeyId } from './keys.ts';

/** Access token lifetime: 1 hour */
const ACCESS_TOKEN_EXPIRY = '1h';

/**
 * Handle POST /oauth/token
 */
export async function handleToken(request: HarperRequest): Promise<Response> {
	let form: Record<string, string>;
	try {
		const rawBody = await readBody(request);
		// Accept both form-urlencoded and JSON
		const contentType = getContentType(request);
		if (contentType.includes('json')) {
			const json = JSON.parse(rawBody);
			form = {};
			for (const [k, v] of Object.entries(json)) {
				form[k] = String(v);
			}
		} else {
			form = parseFormBody(rawBody);
		}
	} catch {
		return errorResponse(400, 'invalid_request', 'Invalid request body');
	}

	const grantType = form.grant_type;

	if (grantType === 'authorization_code') {
		return handleAuthorizationCodeGrant(form, request);
	}

	if (grantType === 'refresh_token') {
		return handleRefreshTokenGrant(form, request);
	}

	return errorResponse(400, 'unsupported_grant_type', 'Unsupported grant_type');
}

/**
 * Exchange an authorization code for tokens.
 */
async function handleAuthorizationCodeGrant(form: Record<string, string>, request: HarperRequest): Promise<Response> {
	const code = form.code;
	const redirectUri = form.redirect_uri;
	const clientId = form.client_id;
	const codeVerifier = form.code_verifier;

	if (!code || !redirectUri || !clientId || !codeVerifier) {
		return errorResponse(
			400,
			'invalid_request',
			'Missing required parameters: code, redirect_uri, client_id, code_verifier'
		);
	}

	// Look up the authorization code
	const codeRecord = await databases.kb.OAuthCode.get(code);
	if (!codeRecord) {
		return errorResponse(400, 'invalid_grant', 'Invalid or expired authorization code');
	}

	// Delete immediately — one-time use enforced before validation to prevent
	// race conditions where two concurrent requests both read the same code
	await databases.kb.OAuthCode.delete(code);

	// Reject pending records (used during GitHub OAuth flow, not real auth codes)
	if ((codeRecord as Record<string, unknown>).type === 'pending') {
		return errorResponse(400, 'invalid_grant', 'Invalid or expired authorization code');
	}

	// Validate client_id and redirect_uri match
	if (codeRecord.clientId !== clientId) {
		return errorResponse(400, 'invalid_grant', 'client_id does not match the authorization code');
	}
	if (codeRecord.redirectUri !== redirectUri) {
		return errorResponse(400, 'invalid_grant', 'redirect_uri does not match the authorization code');
	}

	// PKCE verification: SHA256(code_verifier) must equal stored code_challenge
	// Uses timing-safe comparison to prevent side-channel attacks
	const expectedChallenge = base64urlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
	const storedChallenge = String(codeRecord.codeChallenge);
	const expectedBuf = Buffer.from(expectedChallenge);
	const storedBuf = Buffer.from(storedChallenge);

	if (expectedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(expectedBuf, storedBuf)) {
		return errorResponse(400, 'invalid_grant', 'PKCE code_verifier validation failed');
	}

	// Issue tokens
	const userId = codeRecord.userId as string;
	const scope = codeRecord.scope as string;
	const resource = (codeRecord.resource as string) || '';

	return issueTokens(userId, clientId, scope, resource, request);
}

/**
 * Exchange a refresh token for new tokens (with rotation).
 */
async function handleRefreshTokenGrant(form: Record<string, string>, request: HarperRequest): Promise<Response> {
	const refreshToken = form.refresh_token;
	const clientId = form.client_id;

	if (!refreshToken || !clientId) {
		return errorResponse(400, 'invalid_request', 'Missing required parameters: refresh_token, client_id');
	}

	// Look up the refresh token
	const tokenRecord = await databases.kb.OAuthRefreshToken.get(refreshToken);
	if (!tokenRecord) {
		return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token');
	}

	if (tokenRecord.clientId !== clientId) {
		return errorResponse(400, 'invalid_grant', 'client_id does not match the refresh token');
	}

	// Delete old refresh token (rotation)
	await databases.kb.OAuthRefreshToken.delete(refreshToken);

	const userId = tokenRecord.userId as string;
	const scope = tokenRecord.scope as string;
	const resource = (tokenRecord.resource as string) || '';

	return issueTokens(userId, clientId, scope, resource, request);
}

/**
 * Issue a JWT access token and an opaque refresh token.
 */
async function issueTokens(
	userId: string,
	clientId: string,
	scope: string,
	resource: string,
	request: HarperRequest
): Promise<Response> {
	const baseUrl = getBaseUrl(request);

	// Use the resource URL as the audience when available (KB-scoped token),
	// otherwise fall back to the base MCP path
	const audience = resource || `${baseUrl}/mcp`;

	// Sign JWT access token
	const accessToken = await new SignJWT({
		scope,
		client_id: clientId,
	})
		.setProtectedHeader({ alg: 'RS256', kid: getKeyId() })
		.setSubject(userId)
		.setIssuer(baseUrl)
		.setAudience(audience)
		.setExpirationTime(ACCESS_TOKEN_EXPIRY)
		.setIssuedAt()
		.setJti(crypto.randomUUID())
		.sign(await getPrivateKey());

	// Generate opaque refresh token (carries resource for refresh grant)
	const refreshToken = crypto.randomBytes(32).toString('hex');
	await databases.kb.OAuthRefreshToken.put({
		id: refreshToken,
		clientId,
		userId,
		scope,
		resource,
	});

	logger?.info?.(`OAuth tokens issued for user ${userId}, client ${clientId}`);

	return new Response(
		JSON.stringify({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 3600,
			refresh_token: refreshToken,
			scope,
		}),
		{
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		}
	);
}

function base64urlEncode(buffer: Buffer): string {
	return buffer.toString('base64url');
}

function getContentType(request: HarperRequest): string {
	const headers = request.headers;
	if (!headers) return '';
	if (typeof (headers as any).get === 'function') {
		return (headers as any).get('content-type') || '';
	}
	return ((headers as any)['content-type'] || '') as string;
}

function errorResponse(status: number, error: string, description: string): Response {
	return new Response(JSON.stringify({ error, error_description: description }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
}
