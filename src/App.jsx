import React from "react";
import TradeScanner from "./TradeScanner";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("React render crash:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#060d1a",
            color: "#e2e8f0",
            padding: 24,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Dashboard crashed</h2>
          <div>{String(this.state.error?.message || this.state.error || "Unknown error")}</div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <TradeScanner />
    </ErrorBoundary>
  );
}
