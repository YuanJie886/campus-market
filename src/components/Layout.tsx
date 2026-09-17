import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import BottomNav from './BottomNav';

/** 全局布局：顶部导航 + 内容区 + 移动端底部导航 */
export default function Layout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="cm-app-shell flex min-h-screen flex-col bg-[#f7f9f8]">
      <Navbar />
      <main className="cm-bottom-safe flex-1">
        <div className="mx-auto w-full max-w-app px-3 py-5 sm:px-4 md:px-6 md:py-7">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
