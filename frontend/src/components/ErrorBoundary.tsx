import { Component, type ReactNode } from 'react';
import { downloadBackup } from '../backup';

interface State {
  error: Error | null;
  backupFailed: boolean;
}

/** If rendering ever crashes, show a way out instead of a blank page, and offer the user's data. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, backupFailed: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('The whiteboard crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h1>Something went wrong</h1>
        <p>
          The whiteboard hit an unexpected error. Your drawing is saved in this browser, so reloading
          usually fixes it.
        </p>
        <div className="fatal-actions">
          <button className="share-btn" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="chip-btn"
            onClick={() => {
              try {
                downloadBackup();
              } catch {
                this.setState({ backupFailed: true });
              }
            }}
          >
            Download a backup first
          </button>
        </div>
        {this.state.backupFailed && <p>The backup could not be created.</p>}
        <details>
          <summary>Technical details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </div>
    );
  }
}
