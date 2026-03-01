/**
 * Tests for OAuth token endpoint.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { jwtVerify, createLocalJWKSet } from 'jose';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { handleToken } from '../../dist/oauth/token.js';
import { ensureSigningKey, getJwks } from '../../dist/oauth/keys.js';

function makeRequest(body, contentType = 'application/x-www-form-urlencoded') {
	const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
	return {
		body: bodyStr,
		protocol: 'http',
		host: 'localhost:9926',
		headers: {
			get: (name) => (name === 'content-type' ? contentType : null),
		},
	};
}

function formEncode(params) {
	return new URLSearchParams(params).toString();
}

/**
 * Generate a PKCE code_verifier and code_challenge (S256).
 */
function generatePkce() {
	const verifier = crypto.randomBytes(32).toString('base64url');
	const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

describe('handleToken', () => {
	beforeEach(async () => {
		clearAllTables();
		await ensureSigningKey();
	});

	describe('grant_type validation', () => {
		it('rejects missing grant_type', async () => {
			const response = await handleToken(makeRequest(formEncode({})));
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'unsupported_grant_type');
		});

		it('rejects unknown grant_type', async () => {
			const response = await handleToken(makeRequest(formEncode({ grant_type: 'magic' })));
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'unsupported_grant_type');
		});

		it('rejects invalid request body', async () => {
			const request = {
				body: null,
				protocol: 'http',
				host: 'localhost:9926',
				headers: {
					get: (name) => (name === 'content-type' ? 'application/json' : null),
				},
			};
			// readBody returns "" for null body, then JSON.parse("") throws
			const response = await handleToken(request);
			assert.strictEqual(response.status, 400);
		});
	});

	describe('authorization_code grant', () => {
		it('rejects when required parameters are missing', async () => {
			const response = await handleToken(makeRequest(formEncode({ grant_type: 'authorization_code', code: 'abc' })));
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'invalid_request');
		});

		it('rejects an invalid authorization code', async () => {
			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'nonexistent',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: 'verifier',
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'invalid_grant');
		});

		it('rejects a pending record (not a real auth code)', async () => {
			await databases.kb.OAuthCode.put({
				id: 'pending-code',
				clientId: 'client-1',
				type: 'pending',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'pending-code',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: 'verifier',
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'invalid_grant');
		});

		it('rejects mismatched client_id', async () => {
			const { verifier, challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-1',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'code-1',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'wrong-client',
						code_verifier: verifier,
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.ok(body.error_description.includes('client_id'));
		});

		it('rejects mismatched redirect_uri', async () => {
			const { verifier, challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-2',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'code-2',
						redirect_uri: 'http://localhost:9999/wrong',
						client_id: 'client-1',
						code_verifier: verifier,
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.ok(body.error_description.includes('redirect_uri'));
		});

		it('rejects invalid PKCE code_verifier', async () => {
			const { challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-3',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'code-3',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: 'wrong-verifier',
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.ok(body.error_description.includes('PKCE'));
		});

		it('issues JWT access token and refresh token on valid exchange', async () => {
			const { verifier, challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-ok',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				resource: 'http://localhost:9926/mcp/my-kb',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'code-ok',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: verifier,
					})
				)
			);

			assert.strictEqual(response.status, 200);
			const body = JSON.parse(await response.text());
			assert.ok(body.access_token);
			assert.strictEqual(body.token_type, 'Bearer');
			assert.strictEqual(body.expires_in, 3600);
			assert.ok(body.refresh_token);
			assert.strictEqual(body.scope, 'mcp:read mcp:write');

			// Verify the JWT
			const jwks = createLocalJWKSet(await getJwks());
			const { payload } = await jwtVerify(body.access_token, jwks, {
				issuer: 'http://localhost:9926',
				audience: 'http://localhost:9926/mcp/my-kb',
			});
			assert.strictEqual(payload.sub, 'test:octocat');
			assert.strictEqual(payload.scope, 'mcp:read mcp:write');
			assert.strictEqual(payload.client_id, 'client-1');

			// Auth code should be deleted (one-time use)
			const deleted = await databases.kb.OAuthCode.get('code-ok');
			assert.strictEqual(deleted, null);

			// Refresh token should be stored
			const rt = await databases.kb.OAuthRefreshToken.get(body.refresh_token);
			assert.ok(rt);
			assert.strictEqual(rt.clientId, 'client-1');
			assert.strictEqual(rt.userId, 'test:octocat');
		});

		it('accepts JSON content-type', async () => {
			const { verifier, challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-json',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					{
						grant_type: 'authorization_code',
						code: 'code-json',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: verifier,
					},
					'application/json'
				)
			);

			assert.strictEqual(response.status, 200);
		});

		it('sets no-store cache headers on token response', async () => {
			const { verifier, challenge } = generatePkce();
			await databases.kb.OAuthCode.put({
				id: 'code-cache',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read',
				codeChallenge: challenge,
				codeChallengeMethod: 'S256',
				redirectUri: 'http://localhost:3000/callback',
				type: 'code',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'authorization_code',
						code: 'code-cache',
						redirect_uri: 'http://localhost:3000/callback',
						client_id: 'client-1',
						code_verifier: verifier,
					})
				)
			);

			assert.strictEqual(response.headers.get('Cache-Control'), 'no-store');
		});
	});

	describe('refresh_token grant', () => {
		it('rejects missing parameters', async () => {
			const response = await handleToken(makeRequest(formEncode({ grant_type: 'refresh_token' })));
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'invalid_request');
		});

		it('rejects invalid refresh token', async () => {
			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'refresh_token',
						refresh_token: 'nonexistent',
						client_id: 'client-1',
					})
				)
			);
			assert.strictEqual(response.status, 400);
			const body = JSON.parse(await response.text());
			assert.strictEqual(body.error, 'invalid_grant');
		});

		it('rejects mismatched client_id', async () => {
			await databases.kb.OAuthRefreshToken.put({
				id: 'rt-1',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'refresh_token',
						refresh_token: 'rt-1',
						client_id: 'wrong-client',
					})
				)
			);
			assert.strictEqual(response.status, 400);
		});

		it('issues new tokens and rotates refresh token', async () => {
			await databases.kb.OAuthRefreshToken.put({
				id: 'rt-old',
				clientId: 'client-1',
				userId: 'test:octocat',
				scope: 'mcp:read mcp:write',
				resource: 'http://localhost:9926/mcp/my-kb',
			});

			const response = await handleToken(
				makeRequest(
					formEncode({
						grant_type: 'refresh_token',
						refresh_token: 'rt-old',
						client_id: 'client-1',
					})
				)
			);

			assert.strictEqual(response.status, 200);
			const body = JSON.parse(await response.text());
			assert.ok(body.access_token);
			assert.ok(body.refresh_token);
			assert.notStrictEqual(body.refresh_token, 'rt-old');

			// Old refresh token should be deleted
			const old = await databases.kb.OAuthRefreshToken.get('rt-old');
			assert.strictEqual(old, null);

			// New refresh token should be stored
			const newRt = await databases.kb.OAuthRefreshToken.get(body.refresh_token);
			assert.ok(newRt);
			assert.strictEqual(newRt.userId, 'test:octocat');
		});
	});
});
