export default defineAppConfig({
  pages: [
    'pages/market/index', 'pages/publish/index', 'pages/notifications/index',
    'pages/profile/index', 'pages/detail/index', 'pages/login/index', 'pages/listings/index',
  ],
  window: {
    navigationBarTitleText: '校园集市',
    navigationBarBackgroundColor: '#f6f5f0',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f6f5f0',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#7d857f', selectedColor: '#194e41', backgroundColor: '#ffffff', borderStyle: 'white',
    list: [
      { pagePath: 'pages/market/index', text: '集市', iconPath: 'assets/market.png', selectedIconPath: 'assets/market-active.png' },
      { pagePath: 'pages/publish/index', text: '发布', iconPath: 'assets/publish.png', selectedIconPath: 'assets/publish-active.png' },
      { pagePath: 'pages/notifications/index', text: '通知', iconPath: 'assets/bell.png', selectedIconPath: 'assets/bell-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/profile.png', selectedIconPath: 'assets/profile-active.png' },
    ],
  },
});
