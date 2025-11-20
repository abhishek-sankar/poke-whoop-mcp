import axios from 'axios';
import crypto from 'crypto';
import qs from 'qs';

import { config, redirectUri } from '../config.js';
import { TokenSet, TokenStore } from './token-store.js';

export interface AuthorizationUrlParams {
  state?: string;
  scopes?: string[];
  redirect?: string;
  key?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export class WhoopOAuthClient {
  private readonly authorizeUrl = 'https://api.prod.whoop.com/oauth/oauth2/auth';
  private readonly tokenUrl = 'https://api.prod.whoop.com/oauth/oauth2/token';

  constructor(private readonly tokenStore: TokenStore) { }

  private maybeLogOAuthResponse(stage: 'exchange' | 'refresh', data: OAuthTokenResponse): void {
    if (!config.whoop.logOAuthResponses) {
      return;
    }

    const redact = (token?: string) => {
      if (!token) return token;
      if (token.length <= 8) return '*'.repeat(Math.max(token.length, 4));
      return `${token.slice(0, 4)}…${token.slice(-4)}`;
    };

    // Avoid leaking secrets in logs while still showing whether tokens are present.
    console.info('[WHOOP OAuth]', {
      stage,
      accessToken: redact(data.access_token),
      refreshToken: redact(data.refresh_token),
      expiresIn: data.expires_in,
      scope: data.scope,
      tokenType: data.token_type,
    });
  }

  buildAuthorizationUrl(params: AuthorizationUrlParams = {}): { url: string; state: string } {
    const state = params.state ?? crypto.randomUUID();
    const scopes = params.scopes ?? config.whoop.defaultScopes;
    const redirect = params.redirect ?? redirectUri;

    const query = qs.stringify({
      client_id: config.whoop.clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });

    return { url: `${this.authorizeUrl}?${query}`, state };
  }

  async exchangeCode(code: string, key = 'default', redirect = redirectUri): Promise<TokenSet> {
    const body = qs.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: config.whoop.clientId,
      client_secret: config.whoop.clientSecret,
    });

    const response = await axios.post<OAuthTokenResponse>(this.tokenUrl, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    this.maybeLogOAuthResponse('exchange', response.data);
    const tokenSet = this.normalizeTokenResponse(response.data);
    await this.tokenStore.set(tokenSet, key);
    return tokenSet;
  }

  async refreshToken(key = 'default', redirect = redirectUri): Promise<TokenSet> {
    const existing = await this.tokenStore.get(key);
    if (!existing) {
      throw new Error('No stored WHOOP refresh token');
    }

    const body = qs.stringify({
      grant_type: 'refresh_token',
      refresh_token: existing.refreshToken,
      client_id: config.whoop.clientId,
      client_secret: config.whoop.clientSecret,
      redirect_uri: redirectUri,
      scope: existing.scope,
    });

    const response = await axios.post<OAuthTokenResponse>(this.tokenUrl, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    this.maybeLogOAuthResponse('refresh', response.data);
    const tokenSet = this.normalizeTokenResponse(response.data, existing);
    await this.tokenStore.set(tokenSet, key);
    return tokenSet;
  }

  private normalizeTokenResponse(data: OAuthTokenResponse, previous?: TokenSet): TokenSet {
    const expiresAt = Date.now() + data.expires_in * 1000 - 60_000; // subtract 60s as buffer
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }
}
