import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppConfig, MultiConfig, PublicAppConfig, PublicMultiConfig } from '@shared/types';
import { canUseSecureStorage, readJsonFile, writeJsonFile, writeSecureJsonFile } from './secureStore';

const CONFIG_FILE = 'config.json';

function hasSavedCredentials(config: AppConfig): boolean {
  return !!(config.accessKeyId || config.secretAccessKey);
}

function containsSecrets(config: MultiConfig): boolean {
  return config.buckets.some(hasSavedCredentials);
}

export function toPublicAppConfig(config: AppConfig): PublicAppConfig {
  return {
    bucket: config.bucket,
    region: config.region,
    profile: config.profile,
    hasExplicitCredentials: hasSavedCredentials(config)
  };
}

/**
 * Multi-bucket config store. Lives in Electron's userData dir:
 *   Windows: %APPDATA%/S3Drive/
 *   macOS:   ~/Library/Application Support/S3Drive/
 *   Linux:   ~/.config/S3Drive/
 *
 * Stores a list of saved bucket+region configs with an active index.
 * Backward-compatible: reads old single-config format and migrates it.
 */
export class ConfigStore {
  private path: string;
  private cache: MultiConfig | null = null;

  constructor() {
    const dir = app.getPath('userData');
    this.path = join(dir, CONFIG_FILE);
    if (!existsSync(dirname(this.path))) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
  }

  private save(mc: MultiConfig): void {
    if (canUseSecureStorage() || containsSecrets(mc)) {
      writeSecureJsonFile(this.path, mc);
    } else {
      writeJsonFile(this.path, mc);
    }
    this.cache = mc;
  }

  getAll(): MultiConfig | null {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) return null;
    try {
      const parsed = readJsonFile<any>(this.path);
      if (!parsed) return null;
      // Backward compat: old format had bucket/region at root level
      if (parsed.bucket && parsed.region) {
        this.cache = {
          buckets: [{
            bucket: parsed.bucket,
            region: parsed.region,
            accessKeyId: parsed.accessKeyId,
            secretAccessKey: parsed.secretAccessKey,
            profile: parsed.profile
          }],
          activeIndex: 0
        };
      } else if (Array.isArray(parsed.buckets) && parsed.buckets.length > 0) {
        this.cache = parsed as MultiConfig;
      } else {
        return null;
      }
      if (this.cache && canUseSecureStorage() && containsSecrets(this.cache)) {
        this.save(this.cache);
      }
      return this.cache;
    } catch {
      return null;
    }
  }

  getAllPublic(): PublicMultiConfig | null {
    const mc = this.getAll();
    if (!mc) return null;
    return {
      activeIndex: mc.activeIndex,
      buckets: mc.buckets.map(toPublicAppConfig)
    };
  }

  get(): AppConfig | null {
    const mc = this.getAll();
    if (!mc || mc.buckets.length === 0) return null;
    const idx = Math.max(0, Math.min(mc.activeIndex, mc.buckets.length - 1));
    return mc.buckets[idx] ?? null;
  }

  getPublic(): PublicAppConfig | null {
    const config = this.get();
    return config ? toPublicAppConfig(config) : null;
  }

  /** Add or update a bucket config and make it the active bucket. */
  set(config: AppConfig): void {
    let mc = this.getAll() ?? { buckets: [], activeIndex: 0 };
    const existingIdx = mc.buckets.findIndex(
      (b: AppConfig) => b.bucket === config.bucket && b.region === config.region
    );
    if (existingIdx >= 0) {
      mc.buckets[existingIdx] = config;
      mc.activeIndex = existingIdx;
    } else {
      mc.buckets.push(config);
      mc.activeIndex = mc.buckets.length - 1;
    }
    this.save(mc);
  }

  /** Switch the active bucket by index. Returns the new active config, or null if invalid. */
  setActive(index: number): AppConfig | null {
    const mc = this.getAll();
    if (!mc || index < 0 || index >= mc.buckets.length) return null;
    mc.activeIndex = index;
    this.save(mc);
    return mc.buckets[index];
  }

  /** Remove a bucket by index. */
  remove(index: number): void {
    const mc = this.getAll();
    if (!mc) return;
    mc.buckets.splice(index, 1);
    if (mc.activeIndex >= mc.buckets.length) {
      mc.activeIndex = mc.buckets.length - 1;
    }
    this.save(mc);
  }

  clear(): void {
    this.cache = null;
    if (existsSync(this.path)) {
      writeJsonFile(this.path, {});
    }
  }
}
