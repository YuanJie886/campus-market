import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

/** 懒加载页面时的等待态，风格与站内其他加载态一致。 */
export function RouteLoading() {
  return (
    <Box role="status" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
      <Stack spacing={2} alignItems="center">
        <CircularProgress size={32} aria-hidden />
        <Typography variant="body2" color="text.secondary">页面加载中…</Typography>
      </Stack>
    </Box>
  );
}

interface State { failed: boolean }

/**
 * 懒加载失败的兜底。
 *
 * <p>动态 import 会因网络中断或发布后旧 chunk 失效而抛错；没有边界时用户只会看到白屏。
 * 这里给出可操作的重试与刷新，并保持认证状态不被破坏（不卸载上层 Provider）。
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };
  /**
   * 失败时把焦点移到标题上：否则键盘与读屏用户的焦点停留在一个已经被卸载的元素上，
   * 等同于「迷路」。重试成功后焦点回到新内容由浏览器自然处理。
   */
  private heading = createRef<HTMLHeadingElement>();

  componentDidUpdate(_prev: unknown, prevState: State): void {
    if (this.state.failed && !prevState.failed) this.heading.current?.focus();
  }

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 刻意不打印错误对象：它可能包含请求 URL 等信息，且对用户无意义
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', minHeight: '40vh', pt: 8 }}>
        <Stack spacing={2} alignItems="center">
          <Typography variant="h6" component="h2" tabIndex={-1} ref={this.heading}>页面加载失败</Typography>
          <Typography variant="body2" color="text.secondary">
            网络不稳定，或应用刚刚更新过。可以重试，或刷新页面获取最新版本。
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={this.retry}>重试</Button>
            <Button variant="outlined" onClick={() => window.location.reload()}>刷新页面</Button>
          </Stack>
        </Stack>
      </Box>
    );
  }
}
