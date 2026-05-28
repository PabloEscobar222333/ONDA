import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { env } from './env.js';

let _app: App | null = null;

function app(): App {
  if (_app) return _app;
  const existing = getApps()[0];
  if (existing) {
    _app = existing;
    return _app;
  }
  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
    project_id: string;
    private_key: string;
    client_email: string;
  };
  _app = initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      privateKey: serviceAccount.private_key,
      clientEmail: serviceAccount.client_email,
    }),
    projectId: env.FIREBASE_PROJECT_ID,
  });
  return _app;
}

export function firebaseAuth(): Auth {
  return getAuth(app());
}
