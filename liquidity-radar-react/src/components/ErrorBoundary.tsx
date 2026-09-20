// Crash containment.
//
// Without a boundary, one throw anywhere in the tree unmounts the whole app and
// leaves a white page — on a trading dashboard that is indistinguishable from
// the data being gone. A boundary around each panel keeps a failure local: the
// panel that broke says so, and everything around it keeps streaming.
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  /** Shown in the fallback so the reader knows what is missing. */
  name: string
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on the console rather than swallowed: a panel that quietly renders a
    // shrug is how a bug survives to production.
    console.error('[' + this.props.name + '] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="eb" role="alert">
        <div className="eb-head">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3.6 21.4 20H2.6L12 3.6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path d="M12 9.6v4.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="12" cy="16.9" r="1.1" fill="currentColor" />
          </svg>
          {this.props.name} stopped
        </div>
        <p>
          This panel hit an error and was isolated so the rest of the dashboard keeps running. The
          details are in the browser console.
        </p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}

/** Wrap a panel in its own boundary. */
export function Guard({ name, children }: Props) {
  return <ErrorBoundary name={name}>{children}</ErrorBoundary>
}
