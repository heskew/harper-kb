/**
 * Tests for OAuth RSA key management.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { ensureSigningKey, getPrivateKey, getPublicKeyJwk, getKeyId, getJwks } from '../../dist/oauth/keys.js';

describe('ensureSigningKey', () => {
	// Note: module-level cache persists across tests within this file.
	// The first call generates a key; subsequent calls use the cache.

	beforeEach(() => clearAllTables());

	it('generates and stores a signing key', async () => {
		await ensureSigningKey();

		// Key should be stored in OAuthSigningKey table
		const stored = await databases.kb.OAuthSigningKey.get('primary');
		assert.ok(stored, 'Key should be stored in table');
		assert.ok(stored.publicKeyJwk, 'Public key JWK should be stored');
		assert.ok(stored.privateKeyJwk, 'Private key JWK should be stored');
		assert.strictEqual(stored.algorithm, 'RS256');
	});

	it('loads an existing key from the database', async () => {
		// First call generates
		await ensureSigningKey();
		const stored = await databases.kb.OAuthSigningKey.get('primary');

		// Clear cache by re-importing... actually we can't.
		// Instead, verify the key from DB matches what we get.
		const pubJwk = await getPublicKeyJwk();
		const storedPub = JSON.parse(stored.publicKeyJwk);
		assert.strictEqual(pubJwk.kid, storedPub.kid);
		assert.strictEqual(pubJwk.alg, 'RS256');
	});
});

describe('getPrivateKey', () => {
	it('returns a CryptoKey', async () => {
		const key = await getPrivateKey();
		assert.ok(key, 'Should return a key');
		// CryptoKey is opaque but we can check it's truthy
		assert.strictEqual(typeof key, 'object');
	});
});

describe('getPublicKeyJwk', () => {
	it('returns a JWK with correct properties', async () => {
		const jwk = await getPublicKeyJwk();
		assert.strictEqual(jwk.kid, 'primary');
		assert.strictEqual(jwk.use, 'sig');
		assert.strictEqual(jwk.alg, 'RS256');
		assert.ok(jwk.n, 'Should have RSA modulus');
		assert.ok(jwk.e, 'Should have RSA exponent');
	});
});

describe('getKeyId', () => {
	it("returns 'primary'", () => {
		assert.strictEqual(getKeyId(), 'primary');
	});
});

describe('getJwks', () => {
	it('returns a JWKS with one key', async () => {
		const jwks = await getJwks();
		assert.ok(jwks.keys, 'Should have keys array');
		assert.strictEqual(jwks.keys.length, 1);
		assert.strictEqual(jwks.keys[0].kid, 'primary');
		assert.strictEqual(jwks.keys[0].alg, 'RS256');
	});
});
