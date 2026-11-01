'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, deleteToken, isSupported, onMessage, type Messaging, type MessagePayload } from 'firebase/messaging';

let messagingPromise: Promise<Messaging | null> | null = null;

function firebaseConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  return Object.values(config).every(value => typeof value === 'string' && value.length > 0) ? config : null;
}

export async function getAdminFirebaseMessaging() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !await isSupported()) return null;
  if (!messagingPromise) {
    messagingPromise = Promise.resolve().then(() => {
      const config = firebaseConfig();
      if (!config) return null;
      const app = getApps().find(item => item.name === '[DEFAULT]') || initializeApp(config);
      return getMessaging(app);
    }).catch(() => null);
  }
  return messagingPromise;
}

export async function getAdminFcmToken(registration: ServiceWorkerRegistration) {
  const messaging = await getAdminFirebaseMessaging();
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!messaging || !vapidKey) throw new Error('Firebase Messaging is not supported or configured in this browser build.');
  return { messaging, token: await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }) };
}

export async function disableAdminFcmToken(messaging: Messaging) {
  return deleteToken(messaging);
}

export function listenForAdminFcmMessages(messaging: Messaging, listener: (payload: MessagePayload) => void) {
  return onMessage(messaging, listener);
}
