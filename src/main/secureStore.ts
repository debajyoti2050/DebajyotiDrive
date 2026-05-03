import { safeStorage } from 'electron';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ENVELOPE_MARKER = 's3drive-secure-json';

interface SecureEnvelope {
  type: typeof ENVELOPE_MARKER;
  version: 1;
  data: string;
}

function isEnvelope(value: unknown): value is SecureEnvelope {
  return !!value
    && typeof value === 'object'
    && (value as SecureEnvelope).type === ENVELOPE_MARKER
    && (value as SecureEnvelope).version === 1
    && typeof (value as SecureEnvelope).data === 'string';
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function restrictOwner(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACLs do not map cleanly to chmod; safeStorage still encrypts data.
  }
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isEnvelope(parsed)) return parsed as T;
  const decrypted = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
  return JSON.parse(decrypted) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureParent(path);
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
  restrictOwner(path);
}

export function writeSecureJsonFile(path: string, value: unknown): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Credential encryption is not available on this system. Use an AWS profile or environment variables instead.');
  }

  ensureParent(path);
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  const envelope: SecureEnvelope = {
    type: ENVELOPE_MARKER,
    version: 1,
    data: encrypted.toString('base64')
  };
  writeFileSync(path, JSON.stringify(envelope, null, 2), 'utf-8');
  restrictOwner(path);
}

export function canUseSecureStorage(): boolean {
  return safeStorage.isEncryptionAvailable();
}
