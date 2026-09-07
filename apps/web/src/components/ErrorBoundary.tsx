import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * 页面级兜底。
 *
 * 没有它的时候任何一个页面抛错会让整棵 React 树卸载，浏览器里只剩一片空白，
 * 用户既不知道发生了什么也无法回到别的页面。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] 页面渲染失败', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <main style={{ padding: 40, maxWidth: 720 }}>
          <div className="notice error">
            <span>
              <b>这个页面出错了</b>
              <br />
              {error.message || String(error)}
            </span>
          </div>
          <p className="hint">
            详情已打印到浏览器控制台。可以回到
            <a href="/rooms"> 聊天室列表 </a>
            继续，或点下面的按钮重试本页。
          </p>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </main>
      </div>
    );
  }
}
