import { safeStorage } from 'electron';
import crypto from 'crypto';
import os from 'os';

export class KeyStorage {
  private fallbackKey: Buffer;

  constructor() {
    // Generate a machine-derived key if safeStorage is unavailable
    const machineId = os.hostname() + os.userInfo().username + 'D4IDE_SECRET_SALT_2026';
    this.fallbackKey = crypto.scryptSync(machineId, 'd4ide_salt', 32);
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return '';
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plaintext);
        return 'dpapi:' + encrypted.toString('base64');
      }
    } catch (e) {
      console.warn('safeStorage encryption failed, falling back to AES-GCM:', e);
    }

    // Fallback AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.fallbackKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return 'aes:' + iv.toString('hex') + ':' + authTag + ':' + encrypted;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    try {
      if (ciphertext.startsWith('dpapi:')) {
        const buffer = Buffer.from(ciphertext.slice(6), 'base64');
        return safeStorage.decryptString(buffer);
      }
      if (ciphertext.startsWith('aes:')) {
        const parts = ciphertext.slice(4).split(':');
        if (parts.length === 3) {
          const iv = Buffer.from(parts[0], 'hex');
          const authTag = Buffer.from(parts[1], 'hex');
          const encrypted = parts[2];
          const decipher = crypto.createDecipheriv('aes-256-gcm', this.fallbackKey, iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        }
      }
    } catch (e) {
      console.error('Decryption error:', e);
    }
    return '';
  }
}

export const keyStorage = new KeyStorage();
