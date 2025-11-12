import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch millis
  scope: string;
  tokenType: string;
}

interface TokenFileContents {
  default?: TokenSet;
  [key: string]: TokenSet | undefined;
}

interface TokenStoreAdapter {
  get(key?: string): Promise<TokenSet | null>;
  set(tokenSet: TokenSet, key?: string): Promise<void>;
  clear(key?: string): Promise<void>;
}

class FileTokenStore implements TokenStoreAdapter {
  private absolutePath: string;

  constructor(filePath: string) {
    this.absolutePath = path.resolve(filePath);
  }

  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.absolutePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (
        (err.code === 'ENOENT' || err.code === 'EROFS' || err.code === 'EACCES') &&
        !this.absolutePath.startsWith(os.tmpdir())
      ) {
        const fallbackDir = path.join(os.tmpdir(), 'whoop-tokens');
        this.absolutePath = path.join(fallbackDir, path.basename(this.absolutePath));
        await fs.mkdir(fallbackDir, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  private async readFile(): Promise<TokenFileContents> {
    try {
      const raw = await fs.readFile(this.absolutePath, 'utf-8');
      return JSON.parse(raw) as TokenFileContents;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeFile(contents: TokenFileContents): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.absolutePath, JSON.stringify(contents, null, 2), 'utf-8');
  }

  async get(key = 'default'): Promise<TokenSet | null> {
    const contents = await this.readFile();
    return contents[key] ?? null;
  }

  async set(tokenSet: TokenSet, key = 'default'): Promise<void> {
    const contents = await this.readFile();
    contents[key] = tokenSet;
    await this.writeFile(contents);
  }

  async clear(key = 'default'): Promise<void> {
    const contents = await this.readFile();
    delete contents[key];
    await this.writeFile(contents);
  }
}

type SupabaseClientFactory = () => SupabaseClient;

interface SupabaseTokenRow {
  key: string;
  token: TokenSet;
  updated_at?: string;
}

class SupabaseTokenStore implements TokenStoreAdapter {
  private readonly client: SupabaseClient;
  private readonly table: string;
  private readonly keyPrefix: string | undefined;

  constructor(factory: SupabaseClientFactory, table: string, keyPrefix?: string) {
    this.client = factory();
    this.table = table;
    this.keyPrefix = keyPrefix?.trim() ? keyPrefix : undefined;
  }

  private mapKey(key: string): string {
    if (!this.keyPrefix) {
      return key;
    }
    return `${this.keyPrefix}:${key}`;
  }

  async get(key = 'default'): Promise<TokenSet | null> {
    const mappedKey = this.mapKey(key);
    const { data, error } = await this.client
      .from(this.table)
      .select('token')
      .eq('key', mappedKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read token from Supabase: ${error.message}`);
    }

    return data?.token ?? null;
  }

  async set(tokenSet: TokenSet, key = 'default'): Promise<void> {
    const mappedKey = this.mapKey(key);
    const { error } = await this.client
      .from(this.table)
      .upsert({ key: mappedKey, token: tokenSet } satisfies SupabaseTokenRow, { onConflict: 'key' });

    if (error) {
      throw new Error(`Failed to store token in Supabase: ${error.message}`);
    }
  }

  async clear(key = 'default'): Promise<void> {
    const mappedKey = this.mapKey(key);
    const { error } = await this.client.from(this.table).delete().eq('key', mappedKey);
    if (error) {
      throw new Error(`Failed to delete token from Supabase: ${error.message}`);
    }
  }
}

export class TokenStore implements TokenStoreAdapter {
  private readonly backend: TokenStoreAdapter;

  constructor(filePath: string) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const tokensTable = process.env.SUPABASE_TOKENS_TABLE ?? 'whoop_tokens';
    const keyPrefix = process.env.SUPABASE_TOKENS_PREFIX;

    if (supabaseUrl && serviceRoleKey) {
      const factory: SupabaseClientFactory = () =>
        createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false },
        });
      this.backend = new SupabaseTokenStore(factory, tokensTable, keyPrefix);
    } else {
      this.backend = new FileTokenStore(filePath);
    }
  }

  get(key = 'default'): Promise<TokenSet | null> {
    return this.backend.get(key);
  }

  set(tokenSet: TokenSet, key = 'default'): Promise<void> {
    return this.backend.set(tokenSet, key);
  }

  clear(key = 'default'): Promise<void> {
    return this.backend.clear(key);
  }
}
