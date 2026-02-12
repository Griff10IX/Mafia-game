import { Component } from 'react';
import styles from '../styles/noir.module.css';

export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={`${styles.pageContent} min-h-[40vh] flex items-center justify-center p-8`}>
          <div className={`${styles.panel} rounded-md p-6 max-w-md text-center`}>
            <h2 className="text-lg font-heading font-bold text-primary mb-2">Something went wrong</h2>
            <p className="text-sm text-mutedForeground font-heading mb-4">
              This page failed to load. You can try again or go back.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={this.retry}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 transition-smooth"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider border border-primary/30 text-mutedForeground hover:text-foreground transition-smooth"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
