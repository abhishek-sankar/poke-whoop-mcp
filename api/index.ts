import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { config } from '../src/config.js';
import { TokenStore } from '../src/auth/token-store.js';
import { WhoopOAuthClient } from '../src/auth/whoop-oauth.js';
import { WhoopApiClient } from '../src/whoop/client.js';
import { parseHttpError } from '../src/utils/http-error.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const tokenStore = new TokenStore(config.whoop.tokenStorePath);
const oauthClient = new WhoopOAuthClient(tokenStore);
const whoopClient = new WhoopApiClient(tokenStore, oauthClient);

const pendingStates = new Map<string, { key: string; successRedirect?: string }>();

const server = new McpServer({
  name: 'whoop-mcp',
  version: '1.0.0',
});

const validateApiKey = (req: express.Request, res: express.Response): boolean => {
  const expected = config.mcp.apiKey;
  if (!expected) {
    return true;
  }

  const header = req.headers.authorization;
  const apiKeyHeader = Array.isArray(header) ? header[0] : header;
  const altHeader = req.headers['x-api-key'];
  const alt = Array.isArray(altHeader) ? altHeader[0] : altHeader;

  const provided = apiKeyHeader?.startsWith('Bearer ')
    ? apiKeyHeader.slice('Bearer '.length)
    : apiKeyHeader ?? alt;

  if (provided === expected) {
    return true;
  }

  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32600, message: 'Unauthorized: missing or invalid API key.' },
    id: null,
  });
  return false;
};

const listSleepInputSchema = {
  limit: z.number().int().min(1).max(25).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  nextToken: z.string().optional(),
  key: z.string().optional(),
} satisfies Record<string, z.ZodTypeAny>;
const listSleepInput = z.object(listSleepInputSchema);

server.registerTool(
  'whoop_sleep_recent',
  {
    title: 'WHOOP Recent Sleep',
    description: 'Fetch recent sleep sessions with WHOOP metrics.',
    inputSchema: listSleepInputSchema,
  },
  async (input) => {
    const params = listSleepInput.parse(input);
    const { key = 'default', ...query } = params;

    try {
      const response = await whoopClient.listSleep(query, key);
      const summaryLines = response.records.map((sleep) => {
        const start = new Date(sleep.start).toISOString();
        const end = new Date(sleep.end).toISOString();
        const score = sleep.score?.sleep_performance_percentage;
        const durationHours = ((new Date(sleep.end).getTime() - new Date(sleep.start).getTime()) / 3_600_000).toFixed(2);
        return `• Sleep ${sleep.id} | ${start} → ${end} | duration ${durationHours}h | score ${score ?? 'n/a'}%`;
      });

      const text = [
        `Fetched ${response.records.length} sleep session(s).`,
        ...summaryLines,
        response.next_token ? `Next token: ${response.next_token}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

     return {
        content: [
          { type: 'text', text: `${text}\n\nRaw payload:\n${JSON.stringify(response, null, 2)}` },
        ],
        structuredContent: response as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const { message } = parseHttpError(error);
      throw new Error(`Failed to fetch sleep data: ${message}`);
    }
  },
);

const listCyclesInputSchema = {
  limit: z.number().int().min(1).max(25).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  nextToken: z.string().optional(),
  key: z.string().optional(),
} satisfies Record<string, z.ZodTypeAny>;
const listCyclesInput = z.object(listCyclesInputSchema);

server.registerTool(
  'whoop_cycle_strain',
  {
    title: 'WHOOP Cycle Strain',
    description: 'Fetch recent WHOOP cycles including strain (stress) metrics.',
    inputSchema: listCyclesInputSchema,
  },
  async (input) => {
    const params = listCyclesInput.parse(input);
    const { key = 'default', ...query } = params;

    try {
      const response = await whoopClient.listCycles(query, key);
      const summaryLines = response.records.map((cycle) => {
        const start = new Date(cycle.start).toISOString();
        const end = cycle.end ? new Date(cycle.end).toISOString() : 'ongoing';
        const strain = cycle.score?.strain ?? 'n/a';
        const maxHr = cycle.score?.max_heart_rate ?? 'n/a';
        return `• Cycle ${cycle.id} | ${start} → ${end} | strain ${strain} | max HR ${maxHr}`;
      });

      const text = [
        `Fetched ${response.records.length} cycle(s).`,
        ...summaryLines,
        response.next_token ? `Next token: ${response.next_token}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [
          { type: 'text', text: `${text}\n\nRaw payload:\n${JSON.stringify(response, null, 2)}` },
        ],
        structuredContent: response as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const { message } = parseHttpError(error);
      throw new Error(`Failed to fetch cycle data: ${message}`);
    }
  },
);

app.get('/oauth/whoop/login', (req, res) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : 'default';
    const successRedirect = typeof req.query.next === 'string' ? req.query.next : undefined;
    const scopes = typeof req.query.scopes === 'string'
      ? req.query.scopes.split(',').map((scope) => scope.trim()).filter(Boolean)
      : undefined;

    const { url, state } = oauthClient.buildAuthorizationUrl({ scopes });
    pendingStates.set(state, { key, successRedirect });
    res.redirect(url);
  } catch (error) {
    const { message } = parseHttpError(error);
    res.status(500).send(`Failed to initiate WHOOP OAuth flow: ${message}`);
  }
});

app.get(config.whoop.redirectPath, async (req, res) => {
  const { code, state } = req.query;
  if (typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).send('Missing OAuth code or state.');
    return;
  }

  const entry = pendingStates.get(state);
  if (!entry) {
    res.status(400).send('Unknown or expired OAuth state.');
    return;
  }

  try {
    await oauthClient.exchangeCode(code, entry.key);
    pendingStates.delete(state);
    if (entry.successRedirect) {
      res.redirect(entry.successRedirect);
    } else {
      res.send('WHOOP authorization successful. You can close this window.');
    }
  } catch (error) {
    const { message } = parseHttpError(error);
    res.status(500).send(`Failed to exchange WHOOP authorization code: ${message}`);
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    const token = await tokenStore.get();
    res.json({
      status: 'ok',
      hasToken: Boolean(token),
    });
  } catch (error) {
    const { message } = parseHttpError(error);
    res.status(500).json({ status: 'error', message });
  }
});

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post('/sse', async (req, res) => {
  if (!validateApiKey(req, res)) {
    return;
  }

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  try {
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing MCP session ID.' },
        id: null,
      });
      return;
    }

    const existing = transports.get(sessionId);
    if (!existing) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: `Unknown MCP session: ${sessionId}` },
        id: null,
      });
      return;
    }

    await existing.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP POST request:', error);
    if (!res.headersSent) {
      const { message } = parseHttpError(error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: null,
      });
    }
  }
});

app.get('/sse', async (req, res) => {
  if (!validateApiKey(req, res)) {
    return;
  }

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  if (!sessionId) {
    res.status(400).send('Missing MCP session ID.');
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send(`Unknown MCP session: ${sessionId}`);
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling MCP SSE request:', error);
    if (!res.headersSent) {
      const { message } = parseHttpError(error);
      res.status(500).send(`Failed to establish SSE stream: ${message}`);
    }
  }
});

// Export the Express app for Vercel
export default app;

