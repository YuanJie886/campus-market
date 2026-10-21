import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';

// 与 Vite/nginx 的 /admin/ 挂载路径一致；不要给默认 HashRouter 设置路径前缀。
const router = createBrowserRouter([{ path: '*', element: <App /> }], { basename: '/admin' });
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
