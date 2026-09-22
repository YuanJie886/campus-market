import { Alert, Button } from "@mui/material";
import { useMarket } from "../context/MarketContext";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";

/** 全局布局：顶部导航 + 内容区 + 移动端底部导航 */
export default function Layout() {
  const { loadError, refresh } = useMarket();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="cm-app-shell flex min-h-screen flex-col bg-[#f7f9f8]">
      <Navbar />
      <main className="cm-bottom-safe flex-1">
        <div className={location.pathname === '/' ? 'cm-route-home' : 'cm-route-page'}>
          {loadError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button onClick={() => void refresh().catch(() => {})}>
                  重试
                </Button>
              }
            >
              数据加载失败：{loadError}
            </Alert>
          )}
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
