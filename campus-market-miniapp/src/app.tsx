import { PropsWithChildren } from 'react';
import { MarketProvider } from './state';
import { installPrivacyListener } from './privacyGuard';
import './app.scss';

// 微信隐私授权：启动时注册一次，暂停的隐私接口交给各页面的 PrivacyPopup 处理（不会自动同意）
installPrivacyListener();

export default function App({ children }: PropsWithChildren) {
  return <MarketProvider>{children}</MarketProvider>;
}
