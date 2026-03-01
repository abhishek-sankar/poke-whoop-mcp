import crypto from 'crypto';

import { config } from '../config.js';

interface OAuthStatePayload {
  key: string;
  successRedirect?: string;
  issuedAt: number;
}

const MAX_STATE_AGE_MS = 15 * 60 * 1000;

const encodeBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const sign = (payload: string): string =>
  crypto.createHmac('sha256', config.whoop.clientSecret).update(payload).digest('base64url');

export const createOAuthState = (key: string, successRedirect?: string): string => {
  const payload = encodeBase64Url(JSON.stringify({
    key,
    successRedirect,
    issuedAt: Date.now(),
  } satisfies OAuthStatePayload));

  return `${payload}.${sign(payload)}`;
};

export const parseOAuthState = (state: string): OAuthStatePayload | null => {
  const [payload, signature] = state.split('.', 2);
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as OAuthStatePayload;
    if (!parsed.key || !parsed.issuedAt) {
      return null;
    }

    if (Date.now() - parsed.issuedAt > MAX_STATE_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};
