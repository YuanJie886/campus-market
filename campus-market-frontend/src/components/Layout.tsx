import { Alert, Button } from "@mui/material";
import { useMarket } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import BottomNav from "./BottomNav";

/** 全局布局：顶部导航 + 内容区 + 移动端底部导航 */
export default function Layout() {
  const { loadError, refresh } = useMarket();
  const { authStatus, authNotice } = useAuth();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="cm-app-shell flex min-h-screen flex-col bg-[#f7f9f8]">
      <Navbar />
      <main className="cm-bottom-safe flex-1">
        <div className={location.pathname === '/' ? 'cm-route-home' : 'cm-route-page'}>
          {/*
            会话恢复失败与业务数据加载失败必须分开提示：
            「认证服务暂时不可用」不等于「未登录」，把前者显示成后者会让用户
            反复重试登录，也掩盖了真正的故障。启动恢复只在这两种情况下出声，
            正常的匿名访问不打扰用户。
          */}
          {authNotice && (authStatus === "unavailable" || authStatus === "rate-limited") && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {authNotice}
            </Alert>
          )}
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
