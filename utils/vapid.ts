// VAPID key + Uint8 converter — shared between App.tsx (useNotifications)
// and SettingsView.tsx (PushRegistrationPanel). Safari's PushManager needs
// the key as a Uint8Array, not the raw base64url string.

export const VAPID_KEY =
  'BFdk7N8Nnc2xrMgZuECkQEutiO1emvPepXT8k59122AqcI-EPrCZEA32jU4Lfzz47EZBFPj6QFThBURYAsjU6Es';

export function vapidKeyToUint8(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
