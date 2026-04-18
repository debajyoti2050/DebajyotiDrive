import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppConfig } from '@shared/types';

const CONFIG_FILE = 'config.json';

/**
 * Tiny config store. Lives in Electron's userData dir, which is OS-correct:
 *   macOS:   ~/Library/Application Support/S3Drive/
 *   Windows: %APPDATA%/S3Drive/
 *   Linux:   ~/.config/S3Drive/
 *
 * We deliberately do NOT store AWS credentials here — those come from
 * ~/.aws/credentials via the SDK's credential provider chain. Only the
 * bucket, region, and optional profile name live in our config.
 */
export class ConfigStore {
  private path: string;
  private cache: AppConfig | null = null;

  constructor() {
    const dir = app.getPath('userData');
    this.path = join(dir, CONFIG_FILE);
    if (!existsSync(dirname(this.path))) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
  }

  get(): AppConfig | null {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) return null;
    try {
      const raw = readFileSync(this.path, 'utf-8');
      this.cache = JSON.parse(raw) as AppConfig;
      return this.cache;
    } catch {
      return null;
    }
  }

  set(config: AppConfig): void {
    this.cache = config;
    writeFileSync(this.path, JSON.stringify(config, null, 2), 'utf-8');
  }

  clear(): void {
    this.cache = null;
    if (existsSync(this.path)) {
      writeFileSync(this.path, '{}', 'utf-8');
    }
  }
}
