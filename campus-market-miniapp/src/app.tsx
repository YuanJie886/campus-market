import { PropsWithChildren } from 'react';
import { MarketProvider } from './state';
import './app.scss';

export default function App({ children }: PropsWithChildren) {
  return <MarketProvider>{children}</MarketProvider>;
}
