import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

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

export class TokenStore {
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
