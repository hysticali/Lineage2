import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  exportLocalStorage() {
    try {
      const entries = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('lineage-')) entries[key] = localStorage.getItem(key);
      }
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'rootline-emergency-recovery.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore if storage is inaccessible
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="load-state error-fallback" role="alert">
        <h1 className="fd">Rootline hit an unexpected display error</h1>
        <p>Your saved database or browser data was not deleted. Reload the workspace to continue.</p>
        <div className="toolbar">
          <button type="button" onClick={() => location.reload()}>Reload workspace</button>
          <button type="button" onClick={() => this.exportLocalStorage()}>Download browser recovery data</button>
        </div>
      </main>
    );
  }
}
