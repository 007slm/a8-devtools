import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '32px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#FFFFFF',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#1e293b'
        }}>
          <div style={{
            maxWidth: '640px',
            width: '100%',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
            padding: '28px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: '#fee2e2',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '18px'
              }}>
                !
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>界面渲染捕获异常</h2>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              React 捕获到以下渲染错误，已阻止整窗白屏。请将报错信息反馈或点击重新加载：
            </p>
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '12px',
              fontFamily: 'monospace',
              color: '#dc2626',
              whiteSpace: 'pre-wrap',
              maxHeight: '260px',
              overflow: 'auto',
              marginBottom: '20px'
            }}>
              {this.state.error?.toString()}
              {'\n\n'}
              {this.state.error?.stack}
              {'\n\nComponent Stack:\n'}
              {this.state.errorInfo?.componentStack}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              重新加载应用
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
