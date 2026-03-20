import React from 'react';

export class Boundary extends React.Component<Boundary.Props, Boundary.State> {
  static getDerivedStateFromError(error: Error): Boundary.State {
    return { error };
  }

  readonly state: Boundary.State = { error: null };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="correxit-boundary">
        <p className="correxit-boundary-label">{this.props.label}</p>
        <pre className="correxit-boundary-detail">{error.message}</pre>
        {error.stack && (
          <details>
            <summary>
              <code>error.stack</code>
            </summary>
            <pre className="correxit-boundary-stack">{error.stack}</pre>
          </details>
        )}
      </section>
    );
  }
}

namespace Boundary {
  export type Props = { children: React.ReactNode; label: string };
  export type State = { error: Error | null };
}
