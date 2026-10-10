import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { INVITE_FLOW_PATHS, clearPendingInvite } from './utils/pendingInvite';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import { RouteErrorBoundary, RouteLoading } from './components/RouteFallback';
// 首页与登录/注册留在首包：它们是冷启动的落地页，懒加载只会让首屏多一次往返。
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import NotFoundPage from './pages/NotFoundPage';

// 其余页面按路由懒加载，把它们的依赖（表单、聊天、订单视图等）移出入口 chunk。
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const PublishPage = lazy(() => import('./pages/PublishPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ProfileLayout = lazy(() => import('./pages/profile/ProfileLayout'));
const ProfileInfoPage = lazy(() => import('./pages/profile/ProfileInfoPage'));
const MyListingsPage = lazy(() => import('./pages/profile/MyListingsPage'));
const ContactRequestsPage = lazy(() => import('./pages/profile/ContactRequestsPage'));
const FavoritesPage = lazy(() => import('./pages/profile/FavoritesPage'));
const DemandsPage = lazy(() => import('./pages/DemandsPage'));
// 模块 4：课程教材图谱各页按路由拆包，目录与教材页不进入口 chunk
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const CourseDetailPage = lazy(() => import('./pages/CourseDetailPage'));
const TextbookDetailPage = lazy(() => import('./pages/TextbookDetailPage'));
const TextbookSuggestionsPage = lazy(() => import('./pages/profile/TextbookSuggestionsPage'));
const SupplyWorkbenchPage = lazy(() => import('./pages/SupplyWorkbenchPage'));
const AssistPage = lazy(() => import('./pages/AssistPage'));
// 模块 6：圈子集市各页按路由拆包
const CirclesPage = lazy(() => import('./pages/circles/CirclesPage'));
const CircleCreatePage = lazy(() => import('./pages/circles/CircleCreatePage'));
const CircleDetailPage = lazy(() => import('./pages/circles/CircleDetailPage'));
const CircleProductsPage = lazy(() => import('./pages/circles/CircleProductsPage'));
const CircleManagePage = lazy(() => import('./pages/circles/CircleManagePage'));
const CircleJoinPage = lazy(() => import('./pages/circles/CircleJoinPage'));
// 模块 7：举报、限制与申诉（本人），以及平台工作人员工作台（独立懒加载，非工作人员看不到入口，直接访问后端 403）
const MyReportsPage = lazy(() => import('./pages/governance/MyReportsPage'));
const MyRestrictionsPage = lazy(() => import('./pages/governance/MyRestrictionsPage'));
const ModerationCasesPage = lazy(() => import('./pages/moderation/ModerationCasesPage'));
const ModerationCasePage = lazy(() => import('./pages/moderation/ModerationCasePage'));
const ModerationAppealsPage = lazy(() => import('./pages/moderation/ModerationAppealsPage'));

/**
 * 应用路由表。
 * 所有页面共享 Layout（顶部导航 + 移动端底部导航）。
 */
/** 6.1B：离开登录流程（登录 / 注册 / 邀请页之外的任何页面）时，清除内存里暂存的圈子邀请码 */
function PendingInviteGuard() {
  const location = useLocation();
  useEffect(() => {
    if (!INVITE_FLOW_PATHS.includes(location.pathname)) clearPendingInvite();
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <RouteErrorBoundary>
      <PendingInviteGuard />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        {/* 6.1A：商品详情需要登录，学校由登录身份决定 */}
        <Route path="product/:id" element={<RequireAuth><ProductDetailPage /></RequireAuth>} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route
          path="publish"
          element={
            <RequireAuth>
              <PublishPage />
            </RequireAuth>
          }
        />
        <Route
          path="demands"
          element={
            <RequireAuth>
              <DemandsPage />
            </RequireAuth>
          }
        />
        <Route path="courses" element={<RequireAuth><CoursesPage /></RequireAuth>} />
        <Route path="courses/:courseId" element={<RequireAuth><CourseDetailPage /></RequireAuth>} />
        <Route path="textbooks/:editionId" element={<RequireAuth><TextbookDetailPage /></RequireAuth>} />
        <Route path="publish/batch" element={<RequireAuth><SupplyWorkbenchPage /></RequireAuth>} />
        <Route path="assist" element={<RequireAuth><AssistPage /></RequireAuth>} />
        <Route path="circles" element={<RequireAuth><CirclesPage /></RequireAuth>} />
        <Route path="circles/new" element={<RequireAuth><CircleCreatePage /></RequireAuth>} />
        {/* 6.1B：邀请页自己处理未登录（先把 # 里的邀请码放进内存，再去登录），不能被登录拦截吞掉 */}
        <Route path="circles/join" element={<CircleJoinPage />} />
        <Route path="circles/:id" element={<RequireAuth><CircleDetailPage /></RequireAuth>} />
        <Route path="circles/:id/products" element={<RequireAuth><CircleProductsPage /></RequireAuth>} />
        <Route path="circles/:id/manage" element={<RequireAuth><CircleManagePage /></RequireAuth>} />
        <Route path="moderation" element={<RequireAuth><ModerationCasesPage /></RequireAuth>} />
        <Route path="moderation/cases/:id" element={<RequireAuth><ModerationCasePage /></RequireAuth>} />
        <Route path="moderation/appeals" element={<RequireAuth><ModerationAppealsPage /></RequireAuth>} />
        <Route
          path="messages"
          element={
            <RequireAuth>
              <MessagesPage />
            </RequireAuth>
          }
        />
        <Route
          path="messages/:conversationId"
          element={
            <RequireAuth>
              <MessagesPage />
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth>
              <ProfileLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ProfileInfoPage />} />
          <Route path="listings" element={<MyListingsPage />} />
          <Route path="contact-requests" element={<ContactRequestsPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="textbook-suggestions" element={<TextbookSuggestionsPage />} />
          <Route path="reports" element={<MyReportsPage />} />
          <Route path="restrictions" element={<MyRestrictionsPage />} />
        </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
