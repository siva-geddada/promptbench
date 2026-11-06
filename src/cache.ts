import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Message } from './provider.js';

/** Stores model replies, so a re-run only calls the model for prompts and cases that changed. */
export class Cache {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS responses (
        key TEXT PRIMARY KEY,
        output TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  static key(providerId: string, messages: Message[], json = false) {
    return createHash('sha256').update(JSON.stringify({ providerId, messages, json })).digest('hex');
  }

  get(key: string) {
    const row = this.db.prepare('SELECT output FROM responses WHERE key = ?').get(key);
    return row ? String(row.output) : undefined;
  }

  set(key: string, output: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO responses (key, output, created_at) VALUES (?, ?, ?)')
      .run(key, output, new Date().toISOString());
  }

  close() {
    this.db.close();
  }
}
