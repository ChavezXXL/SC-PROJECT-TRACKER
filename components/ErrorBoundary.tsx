// ErrorBoundary — catches any React render error before it becomes a
// blank black screen.  Workers see a recovery button + can reload without
// losing the PWA install.  Admin console gets a stack trace.
import React from 'react';

interface Props { children: React.ReactNode }
interface State { error: Error | null; reloading: boolean }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[FabTrack] Uncaught render error:', error.message);
    console.error(info.componentStack);
  }

  handleReload = () => {
    this.setState({ reloading: true });
    // Unregister the service worker first so it doesn't serve a stale shell
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => Promise.all(regs.map(r => r.unregister())))
        .finally(() => window.location.reload());
    } else {
      window.location.reload();
    }
  };

  handleDismiss = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error?.message || 'Unknown error';

    return (
      <div style={{
        minHeight: '100dvh',
        background: '#09090b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: 'rgba(239,68,68,0.15)',
          border: '1.5px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20, fontSize: 28,
        }}>⚠️</div>

        <h1 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 8px', letterSpacing: '-0.5px' }}>
          Something went wrong
        </h1>
        <p style={{ color: '#71717a', fontSize: 14, maxWidth: 320, lineHeight: 1.6, margin: '0 0 28px' }}>
          The app hit an unexpected error. Your work is saved — tap reload to get back in.
        </p>

        {/* Error detail (collapsed) */}
        <details style={{ maxWidth: 360, marginBottom: 24, textAlign: 'left' }}>
          <summary style={{ color: '#52525b', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
            Error detail
          </summary>
          <pre style={{
            marginTop: 8, padding: '10px 14px', background: '#18181b',
            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
            fontSize: 11, color: '#f87171', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          }}>{msg}</pre>
        </details>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={this.handleReload}
            disabled={this.state.reloading}
            style={{
              background: 'linear-gradient(135deg,#f97316,#f59e0b)',
              color: '#fff', border: 'none', borderRadius: 12,
              padding: '12px 28px', fontSize: 15, fontWeight: 700,
              cursor: 'pointer', opacity: this.state.reloading ? 0.6 : 1,
            }}
          >
            {this.state.reloading ? 'Reloading…' : '↺  Reload App'}
          </button>
          <button
            onClick={this.handleDismiss}
            style={{
              background: 'rgba(255,255,255,0.05)', color: '#a1a1aa',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
              padding: '12px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try anyway
          </button>
        </div>
      </div>
    );
  }
}
