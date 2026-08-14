import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

type ErrorBoundaryState = { error: string };

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error-screen">
          <strong>❌ Nihongo Whisper mengalami error</strong>
          <p>{this.state.error}</p>
          <button onClick={() => window.location.reload()}>Muat ulang aplikasi</button>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
