/**
 * OAuth RSA Key Management
 *
 * Generates, stores, loads, and caches an RS256 key pair for signing JWT
 * access tokens. The key is stored in the OAuthSigningKey table so all
 * Harper worker threads share the same key.
 */

import { generateKeyPair, exportJWK, importJWK, type JWK } from 'jose';

const KEY_ID = 'primary';

let cachedPrivateKey: CryptoKey | null = null;
let cachedPublicKeyJwk: JWK | null = null;

/**
 * Ensure a signing key exists. Loads from DB or generates a new one.
 * Called once during handleApplication() on each worker thread.
 */
export async function ensureSigningKey(): Promise<void> {
	const existing = await databases.kb.OAuthSigningKey.get(KEY_ID);

	if (existing && existing.publicKeyJwk && existing.privateKeyJwk) {
		cachedPublicKeyJwk = toJwk(existing.publicKeyJwk);
		cachedPrivateKey = (await importJWK(toJwk(existing.privateKeyJwk), 'RS256')) as CryptoKey;
		logger?.info?.('OAuth signing key loaded from database');
		return;
	}

	// Generate a new RSA key pair
	const { publicKey, privateKey } = await generateKeyPair('RS256', {
		extractable: true,
	});
	const pubJwk = await exportJWK(publicKey);
	const privJwk = await exportJWK(privateKey);

	pubJwk.kid = KEY_ID;
	pubJwk.use = 'sig';
	pubJwk.alg = 'RS256';

	try {
		await databases.kb.OAuthSigningKey.put({
			id: KEY_ID,
			publicKeyJwk: JSON.stringify(pubJwk),
			privateKeyJwk: JSON.stringify(privJwk),
			algorithm: 'RS256',
		});
	} catch {
		// Another worker may have created the key concurrently — reload
		const reloaded = await databases.kb.OAuthSigningKey.get(KEY_ID);
		if (reloaded && reloaded.publicKeyJwk && reloaded.privateKeyJwk) {
			cachedPublicKeyJwk = toJwk(reloaded.publicKeyJwk);
			cachedPrivateKey = (await importJWK(toJwk(reloaded.privateKeyJwk), 'RS256')) as CryptoKey;
			logger?.info?.('OAuth signing key loaded after concurrent creation');
			return;
		}
		throw new Error('Failed to create or load OAuth signing key');
	}

	cachedPrivateKey = privateKey;
	cachedPublicKeyJwk = pubJwk;
	logger?.info?.('OAuth signing key generated and stored');
}

/**
 * Get the private key for signing JWTs.
 * Lazily initializes if not yet loaded.
 */
export async function getPrivateKey(): Promise<CryptoKey> {
	if (!cachedPrivateKey) {
		await ensureSigningKey();
	}
	return cachedPrivateKey!;
}

/**
 * Get the public key JWK for token verification and JWKS endpoint.
 * Lazily initializes if not yet loaded.
 */
export async function getPublicKeyJwk(): Promise<JWK> {
	if (!cachedPublicKeyJwk) {
		await ensureSigningKey();
	}
	return cachedPublicKeyJwk!;
}

/**
 * Get the key ID for the JWT header.
 */
export function getKeyId(): string {
	return KEY_ID;
}

/**
 * Get the JWKS response body for the /oauth/jwks endpoint.
 */
export async function getJwks(): Promise<{ keys: JWK[] }> {
	return { keys: [await getPublicKeyJwk()] };
}

/**
 * Normalize a value from Harper's table into a JWK object.
 * Harper's `Any` column type may return the JWK as a string or wrapped object.
 */
function toJwk(value: unknown): JWK {
	if (typeof value === 'string') {
		return JSON.parse(value) as JWK;
	}
	if (value && typeof value === 'object') {
		return value as JWK;
	}
	throw new Error(`Cannot convert ${typeof value} to JWK`);
}
