// Firebase Admin SDK — server-side push notification sender
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { db } from './db';
import { deviceTokens } from '../shared/schema';
import { eq } from 'drizzle-orm';

let adminApp: App | null = null;

// Read the service account JSON, preferring an env var (survives container redeploys
// on hosts like Coolify where the git-ignored key file is wiped on each deploy) and
// falling back to a file on disk for local development.
// FIREBASE_SERVICE_ACCOUNT may hold the raw JSON or a base64-encoded copy of it.
function loadServiceAccount(): Record<string, any> | null {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (fromEnv) {
    const raw = fromEnv.startsWith('{') ? fromEnv : Buffer.from(fromEnv, 'base64').toString('utf-8');
    return JSON.parse(raw);
  }
  // Try both server/ (development) and dist/ (production) locations
  const candidates = [
    resolve(process.cwd(), 'server', 'firebase-service-account.json'),
    resolve(process.cwd(), 'dist', 'firebase-service-account.json'),
  ];
  const keyPath = candidates.find(p => existsSync(p));
  if (!keyPath) return null;
  return JSON.parse(readFileSync(keyPath, 'utf-8'));
}

function getAdminApp(): App | null {
  if (adminApp) return adminApp;
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      console.warn('Firebase service account not found (set FIREBASE_SERVICE_ACCOUNT or add the key file) — push notifications disabled');
      return null;
    }
    if (getApps().length === 0) {
      adminApp = initializeApp({ credential: cert(serviceAccount) });
    } else {
      adminApp = getApps()[0];
    }
    return adminApp;
  } catch {
    console.warn('Firebase Admin init failed — push notifications disabled');
    return null;
  }
}

export async function sendPushToUser(
  userId: number,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<void> {
  const app = getAdminApp();
  if (!app) return;

  try {
    const tokens = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, userId));
    if (!tokens.length) return;

    const messaging = getMessaging(app);
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map(t => t.token),
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'appointments' },
      },
    });

    // Remove only tokens that are permanently invalid (not temporary failures)
    const permanentlyInvalidCodes = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ];
    const invalidTokens = response.responses
      .map((r, i) => {
        if (r.success) return null;
        const code = (r.error as any)?.code;
        return permanentlyInvalidCodes.includes(code) ? tokens[i].token : null;
      })
      .filter(Boolean) as string[];

    if (invalidTokens.length > 0) {
      for (const token of invalidTokens) {
        await db.delete(deviceTokens).where(eq(deviceTokens.token, token));
      }
    }
  } catch (err) {
    console.error('Failed to send push notification:', err);
  }
}
