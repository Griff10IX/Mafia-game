import { Component } from 'react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

/** Same key/cooldown as src/index.js — avoid infinite reload when a lazy chunk fails repeatedly. */
const CHUNK_ERROR_RELOAD_KEY = 'chunk_error_reload_at';
const CHUNK_ERROR_RELOAD_COOLDOWN_MS = 15000;
/** Never leave players on "Loading new version…" longer than this. */
const CHUNK_LOADING_SAFETY_MS = 1500;

function hardReloadForNewBuild() {
  // Do NOT clear CHUNK_ERROR_RELOAD_KEY here — clearing it caused an infinite
  // "Loading new version…" reload loop (cooldown never stuck).
  try {
    const path = window.location.pathname || '/';
    const params = new URLSearchParams(window.location.search || '');
    params.set('_mw', String(Date.now()));
    const q = params.toString();
    window.location.replace(`${path}?${q}${window.location.hash || ''}`);
  } catch (_) {
    window.location.reload();
  }
}

/**
 * Schedule one cache-busting reload for a stale chunk after deploy.
 * Always returns immediately; call onSkipped when the reload will not run
 * (cooldown) so the UI is not stuck on "Loading new version…".
 */
function scheduleChunkErrorReloadOnce({ onSkipped } = {}) {
  const notifySkipped = () => {
    try {
      if (typeof onSkipped === 'function') onSkipped();
    } catch (_) {}
  };

  const attempt = () => {
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        const onVis = () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', onVis);
          setTimeout(attempt, 800);
        };
        document.addEventListener('visibilitychange', onVis);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const onOnline = () => {
          window.removeEventListener('online', onOnline);
          setTimeout(attempt, 600);
        };
        window.addEventListener('online', onOnline);
        return;
      }
      const last = sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY);
      const now = Date.now();
      if (last && now - parseInt(last, 10) < CHUNK_ERROR_RELOAD_COOLDOWN_MS) {
        notifySkipped();
        return;
      }
      sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, String(now));
      hardReloadForNewBuild();
    } catch (_) {
      notifySkipped();
    }
  };
  setTimeout(attempt, 700);
}

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, reported: false, reportLoading: false, chunkReloadSkipped: false };
  _chunkSafetyTimer = null;

  static getDerivedStateFromError(error) {
    return { hasError: true, error, chunkReloadSkipped: false };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
    const msg = error?.message || String(error);
    if (this.isChunkLoadError(msg)) {
      scheduleChunkErrorReloadOnce({
        onSkipped: () => {
          if (this._chunkSafetyTimer) {
            clearTimeout(this._chunkSafetyTimer);
            this._chunkSafetyTimer = null;
          }
          this.setState({ chunkReloadSkipped: true });
        },
      });
      // Safety net: if reload is waiting on visibility/online or never fires, unstick the UI.
      if (this._chunkSafetyTimer) clearTimeout(this._chunkSafetyTimer);
      this._chunkSafetyTimer = setTimeout(() => {
        this.setState({ chunkReloadSkipped: true });
      }, CHUNK_LOADING_SAFETY_MS);
    }
  }

  componentWillUnmount() {
    if (this._chunkSafetyTimer) {
      clearTimeout(this._chunkSafetyTimer);
      this._chunkSafetyTimer = null;
    }
  }

  retry = () => {
    if (this._chunkSafetyTimer) {
      clearTimeout(this._chunkSafetyTimer);
      this._chunkSafetyTimer = null;
    }
    this.setState({ hasError: false, error: null, chunkReloadSkipped: false });
  };

  reportToHelpDesk = () => {
    if (this.state.reported || this.state.reportLoading) return;
    const err = this.state.error;
    const msg = err?.message || String(err);
    const stack = err?.stack || '';
    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
    this.setState({ reportLoading: true });
    api.post('/help-desk/error-report', {
      error_message: msg,
      stack_trace: stack,
      page_url: pageUrl,
    }).then(() => {
      this.setState({ reported: true, reportLoading: false });
    }).catch((e) => {
      this.setState({ reportLoading: false });
      if (e?.response?.status === 401) return;
      toast.error(e?.response?.data?.detail || 'Failed to report');
    });
  };

  isChunkLoadError(msg) {
    if (!msg || typeof msg !== 'string') return false;
    return msg.includes('Loading chunk') || msg.includes('ChunkLoadError') || msg.includes('Loading CSS chunk') || /Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const msg = err?.message || String(err);
      const isChunkError = this.isChunkLoadError(msg);
      if (isChunkError) {
        if (this.state.chunkReloadSkipped) {
          return (
            <div className={`${styles.pageContent} min-h-[40vh] flex items-center justify-center p-8`}>
              <div className={`${styles.panel} rounded-md p-6 max-w-md text-center space-y-4`}>
                <h2 className="text-lg font-heading font-bold text-primary">Could not load this page</h2>
                <p className="text-sm text-mutedForeground font-heading">
                  The game code bundle failed to load (often right after a deploy). Tap reload for a fresh copy.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        sessionStorage.removeItem(CHUNK_ERROR_RELOAD_KEY);
                      } catch (_) {}
                      hardReloadForNewBuild();
                    }}
                    className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 transition-smooth"
                  >
                    Reload now
                  </button>
                  <button
                    type="button"
                    onClick={this.retry}
                    className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider border border-primary/30 text-mutedForeground hover:text-foreground transition-smooth"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className={`${styles.pageContent} min-h-[40vh] flex items-center justify-center p-8`}>
            <div className={`${styles.panel} rounded-md p-6 max-w-md text-center space-y-4`}>
              <p className="text-sm text-mutedForeground font-heading">Loading new version…</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(CHUNK_ERROR_RELOAD_KEY);
                  } catch (_) {}
                  hardReloadForNewBuild();
                }}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 transition-smooth"
              >
                Reload now
              </button>
            </div>
          </div>
        );
      }
      const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
      return (
        <div className={`${styles.pageContent} min-h-[40vh] flex items-center justify-center p-8`}>
          <div className={`${styles.panel} rounded-md p-6 max-w-md text-center`}>
            <h2 className="text-lg font-heading font-bold text-primary mb-2">Something went wrong</h2>
            <p className="text-sm text-mutedForeground font-heading mb-4">
              This page failed to load. You can try again or go back.
            </p>
            {msg && (
              <p className="text-xs text-left text-red-300/90 font-mono mb-4 p-2 rounded bg-black/30 break-all">
                {msg}
              </p>
            )}
            {isDev && err?.stack && (
              <pre className="text-[10px] text-left text-mutedForeground overflow-auto max-h-32 mb-4 p-2 rounded bg-black/30 whitespace-pre-wrap">
                {err.stack}
              </pre>
            )}
            <div className="flex gap-3 justify-center flex-wrap">
              <button
                type="button"
                onClick={this.retry}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 transition-smooth"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.history.length > 1) {
                    window.history.back();
                  } else {
                    window.location.href = '/';
                  }
                }}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider border border-primary/30 text-mutedForeground hover:text-foreground transition-smooth"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={this.reportToHelpDesk}
                disabled={this.state.reported || this.state.reportLoading}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider border border-primary/30 text-mutedForeground hover:text-foreground hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
              >
                {this.state.reported ? 'Reported!' : this.state.reportLoading ? 'Sending…' : 'Report to Help Desk'}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
