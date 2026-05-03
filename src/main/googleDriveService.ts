import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { createServer } from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { GDriveConfig, GDriveFile } from '@shared/types';
import { canUseSecureStorage, readJsonFile, writeSecureJsonFile } from './secureStore';

const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const WORKSPACE_EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document':     { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet':  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       ext: '.xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
  'application/vnd.google-apps.drawing':      { mime: 'image/png', ext: '.png' },
};

export class GoogleDriveService {
  private auth: OAuth2Client;
  private tokensPath: string;

  constructor(cfg: GDriveConfig, userDataPath: string) {
    this.tokensPath = join(userDataPath, 'gdrive-tokens.json');
    this.auth = new OAuth2Client(cfg.clientId, cfg.clientSecret, REDIRECT_URI);
    if (existsSync(this.tokensPath)) {
      try {
        const tokens = readJsonFile<Parameters<OAuth2Client['setCredentials']>[0]>(this.tokensPath);
        if (tokens) {
          this.auth.setCredentials(tokens);
          if (canUseSecureStorage()) writeSecureJsonFile(this.tokensPath, tokens);
        }
      } catch { /* corrupt file — ignore */ }
    }
  }

  isConnected(): boolean {
    return !!this.auth.credentials?.access_token;
  }

  getAuthUrl(state: string): string {
    return this.auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state,
      scope: ['https://www.googleapis.com/auth/drive.readonly'],
    });
  }

  async authenticate(openUrl: (url: string) => void | Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const state = randomBytes(32).toString('base64url');
      let settled = false;
      let timeout: NodeJS.Timeout;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        if (err) reject(err);
        else resolve();
      };

      const server = createServer(async (req, res) => {
        if (!req.url) {
          res.writeHead(404).end();
          return;
        }
        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }

        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const returnedState = url.searchParams.get('state');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid authentication state.</h2></body></html>');
          finish(new Error('Invalid Google Drive authentication state.'));
          return;
        }

        if (error || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Google Drive connection failed.</h2></body></html>');
          finish(new Error(error ?? 'No code returned'));
          return;
        }

        try {
          const { tokens } = await this.auth.getToken(code);
          this.auth.setCredentials(tokens);
          writeSecureJsonFile(this.tokensPath, tokens);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Connected! You can close this tab.</h2></body></html>');
          finish();
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Google Drive connection failed.</h2></body></html>');
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });

      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        try {
          Promise.resolve(openUrl(this.getAuthUrl(state))).catch((err) => {
            finish(err instanceof Error ? err : new Error(String(err)));
          });
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });

      server.on('error', (err) => finish(err));
      timeout = setTimeout(() => finish(new Error('Auth timeout (5 min).')), 5 * 60 * 1000);
    });
  }

  async listFiles(folderId = 'root'): Promise<GDriveFile[]> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    const files: GDriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime)',
        pageSize: 200,
        pageToken,
        orderBy: 'folder,name',
      });

      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue;
        const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
        const exportInfo = f.mimeType ? WORKSPACE_EXPORTS[f.mimeType] : undefined;
        files.push({
          id: f.id,
          name: exportInfo ? f.name + exportInfo.ext : f.name,
          mimeType: f.mimeType ?? 'application/octet-stream',
          size: Number(f.size ?? 0),
          modifiedTime: f.modifiedTime ?? undefined,
          isFolder,
          exportMimeType: exportInfo?.mime,
          exportExtension: exportInfo?.ext,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files;
  }

  async getFileStream(file: GDriveFile): Promise<{ stream: Readable; size: number }> {
    const drive = google.drive({ version: 'v3', auth: this.auth });

    if (file.exportMimeType) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: file.exportMimeType },
        { responseType: 'stream' }
      );
      return { stream: res.data as unknown as Readable, size: file.size || 0 };
    }

    const res = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'stream' }
    );
    const contentLength = Number((res.headers as Record<string, string>)['content-length'] ?? file.size);
    return { stream: res.data as unknown as Readable, size: contentLength };
  }

  disconnect(): void {
    this.auth.setCredentials({});
    if (existsSync(this.tokensPath)) {
      try { unlinkSync(this.tokensPath); } catch { /* ignore */ }
    }
  }
}
