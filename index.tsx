import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './backend/AuthContext';
import { SignupPage } from './views/auth/SignupPage';
import { LoginPage } from './views/auth/LoginPage';
import { UpgradePage } from './views/billing/UpgradePage';
import { SuccessPage } from './views/billing/SuccessPage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// ─────────────────────────────────────────────────────────────────────
// Path-based routing (no router lib needed for v1)
//
// /signup  → SignupPage
// /login   → LoginPage
// anything else → the existing App (legacy SC Deburring or signed-in tenant)
//
// AuthProvider wraps everything so any descendant can call useAuth()
// and the app can react to sign-in / sign-out.
// ─────────────────────────────────────────────────────────────────────
function Root() {
  const path = window.location.pathname;
  if (path === '/signup' || path.startsWith('/signup/')) return <SignupPage />;
  if (path === '/login' || path.startsWith('/login/')) return <LoginPage />;
  if (path === '/billing/upgrade') return <UpgradePage />;
  if (path === '/billing/success') return <SuccessPage />;
  return <App />;
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>
);
