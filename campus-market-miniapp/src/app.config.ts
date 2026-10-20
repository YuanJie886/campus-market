export default defineAppConfig({
  pages: [
    'pages/market/index', 'pages/publish/index', 'pages/notifications/index',
    'pages/profile/index', 'pages/detail/index', 'pages/login/index', 'pages/listings/index',
    'pages/password/index', 'pages/password-reset/index', 'pages/account-deletion/index',
    'pages/terms/index', 'pages/privacy/index',
  ],
  // 微信隐私授权：调用相册、剪贴板等隐私接口前须用户同意（wx.onNeedPrivacyAuthorization 由 src/privacyGuard.ts 处理）。
  // 2023-09-15 之后微信已默认启用；显式写上，保证旧基础库也走同一流程。
  __usePrivacyCheck__: true,
  window: {
    navigationBarTitleText: '校园集市',
    navigationBarBackgroundColor: '#f6f5f0',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f6f5f0',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    custom: true,
    color: '#7d857f', selectedColor: '#194e41', backgroundColor: '#ffffff', borderStyle: 'white',
    list: [
      { pagePath: 'pages/market/index', text: '集市', iconPath: 'assets/market.png', selectedIconPath: 'assets/market-active.png' },
      { pagePath: 'pages/listings/index', text: '闲置', iconPath: 'assets/bell.png', selectedIconPath: 'assets/bell-active.png' },
      { pagePath: 'pages/publish/index', text: '发布', iconPath: 'assets/publish.png', selectedIconPath: 'assets/publish-active.png' },
      { pagePath: 'pages/notifications/index', text: '通知', iconPath: 'assets/bell.png', selectedIconPath: 'assets/bell-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/profile.png', selectedIconPath: 'assets/profile-active.png' },
    ],
  },
});
