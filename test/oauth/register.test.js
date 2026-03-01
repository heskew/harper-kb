/**
 * Tests for OAuth Dynamic Client Registration (RFC 7591).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { handleRegister } from '../../dist/oauth/register.js';

function makeRequest(body) {
	const json = JSON.stringify(body);
	return {
		body: json,
		headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
	};
}

describe('handleRegister', () => {
	beforeEach(() => clearAllTables());

	it('registers a client with valid redirect_uris', async () => {
		const response = await handleRegister(
			makeRequest({
				client_name: 'Test Client',
				redirect_uris: ['http://localhost:3000/callback'],
			})
		);

		assert.strictEqual(response.status, 201);
		const body = JSON.parse(await response.text());
		assert.ok(body.client_id);
		assert.strictEqual(body.client_name, 'Test Client');
		assert.deepStrictEqual(body.redirect_uris, ['http://localhost:3000/callback']);
		assert.ok(body.client_id_issued_at);

		// Verify stored in table
		const stored = await databases.kb.OAuthClient.get(body.client_id);
		assert.ok(stored);
		assert.strictEqual(stored.clientName, 'Test Client');
	});

	it('accepts https redirect_uris', async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['https://example.com/callback'],
			})
		);
		assert.strictEqual(response.status, 201);
	});

	it('accepts localhost redirect_uris (127.0.0.1)', async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['http://127.0.0.1:8080/callback'],
			})
		);
		assert.strictEqual(response.status, 201);
	});

	it('rejects non-https, non-localhost redirect_uris', async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['http://evil.example.com/steal'],
			})
		);
		assert.strictEqual(response.status, 400);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.error, 'invalid_redirect_uri');
	});

	it('rejects missing redirect_uris', async () => {
		const response = await handleRegister(makeRequest({}));
		assert.strictEqual(response.status, 400);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.error, 'invalid_redirect_uri');
	});

	it('rejects empty redirect_uris array', async () => {
		const response = await handleRegister(makeRequest({ redirect_uris: [] }));
		assert.strictEqual(response.status, 400);
	});

	it('rejects non-string redirect_uri entries', async () => {
		const response = await handleRegister(makeRequest({ redirect_uris: [123] }));
		assert.strictEqual(response.status, 400);
	});

	it('rejects invalid URL in redirect_uris', async () => {
		const response = await handleRegister(makeRequest({ redirect_uris: ['not-a-url'] }));
		assert.strictEqual(response.status, 400);
	});

	it('rejects invalid JSON body', async () => {
		const response = await handleRegister({
			body: 'not json',
			headers: { get: () => null },
		});
		assert.strictEqual(response.status, 400);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.error, 'invalid_client_metadata');
	});

	it("defaults client_name to 'Unknown Client'", async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['http://localhost:3000/callback'],
			})
		);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.client_name, 'Unknown Client');
	});

	it('defaults grant_types to authorization_code', async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['http://localhost:3000/callback'],
			})
		);
		const body = JSON.parse(await response.text());
		assert.deepStrictEqual(body.grant_types, ['authorization_code']);
	});

	it('defaults response_types to code', async () => {
		const response = await handleRegister(
			makeRequest({
				redirect_uris: ['http://localhost:3000/callback'],
			})
		);
		const body = JSON.parse(await response.text());
		assert.deepStrictEqual(body.response_types, ['code']);
	});
});
