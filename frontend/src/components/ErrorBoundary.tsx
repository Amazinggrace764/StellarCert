import { Component, ErrorInfo, ReactNode, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Invoked after the boundary clears its own error state.
   *
   * A `React.lazy` import that rejects (chunk missing after a deploy, bad
   * module specifier, offline) is cached by React, so re-rendering the same
   * lazy component re-throws the original error. Callers that know their child
   * is a lazy chunk can use this hook to recover properly — e.g. reload the
   * page to pick up the current asset manifest.
   */
  onReset?: () => void;
  /**
   * Changes to this value clear any caught error. Use it to reset the
   * boundary on navigation (e.g. pass the current pathname).
   */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  message: string;
  resetKey?: string;
}

class ErrorBoundaryImpl extends Component<Props, State> {
  state: State = { hasError: false, message: "", resetKey: undefined };

  static getDerivedStateFromError(error: Error): Pick<State, "hasError" | "message"> {
    return { hasError: true, message: error.message };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, message: "", resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private reset = () => {
    const { onReset } = this.props;
    this.setState({ hasError: false, message: "" });
    onReset?.();
  };

  private reload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <h2 className="text-2xl font-semibold text-red-600 mb-2">Something went wrong</h2>
          <p className="text-gray-500 mb-4">{this.state.message || "An unexpected error occurred."}</p>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={this.reset}
            >
              Try again
            </button>
            <button
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              onClick={this.reload}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children, fallback, onReset }: Props) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [key, setKey] = useState(0);

  // Reset error boundary when route changes
  useEffect(() => {
    setKey((k) => k + 1);
  }, [location.pathname]);

  const handleReset = () => {
    // Clear cached query errors so remounted children refetch instead of
    // immediately re-rendering stale error states.
    queryClient.resetQueries();
    onReset?.();
  };

  return (
    <ErrorBoundaryImpl key={key} fallback={fallback} onReset={handleReset}>
      {children}
    </ErrorBoundaryImpl>
  );
}

export default ErrorBoundary;
