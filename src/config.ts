import dotenv from 'dotenv';

dotenv.config();

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? '3000'),
  host: process.env.HOST ?? '0.0.0.0',
  baseUrl: required(process.env.PUBLIC_BASE_URL, 'PUBLIC_BASE_URL'),
  mcp: {
    apiKey: process.env.MCP_API_KEY,
  },
  whoop: {
    clientId: required(process.env.WHOOP_CLIENT_ID, 'WHOOP_CLIENT_ID'),
    clientSecret: required(process.env.WHOOP_CLIENT_SECRET, 'WHOOP_CLIENT_SECRET'),
    redirectPath: process.env.WHOOP_REDIRECT_PATH ?? '/oauth/whoop/callback',
    defaultScopes:
      process.env.WHOOP_SCOPES?.split(',').map((scope) => scope.trim()).filter(Boolean) ?? [
        'read:sleep',
        'read:cycles',
        'read:profile',
      ],
    tokenStorePath: process.env.TOKEN_STORE_PATH ?? './data/whoop-tokens.json',
  },
};

export const redirectUri = `${config.baseUrl}${config.whoop.redirectPath}`;
