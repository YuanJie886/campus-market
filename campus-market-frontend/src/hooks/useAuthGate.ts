import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * 统一处理需要登录的动作，并保留用户原本想去的路径。
 * fromOverride 用于“先登录再进入下一步”的流程，例如下单确认页。
 */
export function useAuthGate() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (action: () => void, fromOverride?: string) => {
      if (isAuthenticated) {
        action();
        return true;
      }

      navigate("/login", {
        state: {
          from:
            fromOverride ?? `${location.pathname}${location.search}${location.hash}`,
        },
      });
      return false;
    },
    [isAuthenticated, location.hash, location.pathname, location.search, navigate],
  );
}
