import { Component } from 'react'
import Taro from '@tarojs/taro'
import { CoverView, CoverImage } from '@tarojs/components'
import { unread } from '../state'
import { badgeText } from '../contacts'
import './index.scss'

const NOTIFICATIONS = '/pages/notifications/index'

export default class CustomTabBar extends Component {
  private unsubscribe: (() => void) | null = null

  state = {
    selected: 0,
    // 联系申请未读数（卖家未读的新申请 + 买家未读的结果）；自定义 tabBar 下 setTabBarBadge 不生效，角标在这里渲染
    badge: '',
    list: [
      {
        pagePath: '/pages/market/index',
        text: '集市',
        iconPath: '/assets/market.png',
        selectedIconPath: '/assets/market-active.png'
      },
      {
        pagePath: '/pages/listings/index',
        text: '闲置',
        iconPath: '/assets/bell.png',
        selectedIconPath: '/assets/bell-active.png'
      },
      {
        pagePath: '/pages/publish/index',
        text: '发布',
        iconPath: '/assets/publish.png',
        selectedIconPath: '/assets/publish-active.png',
        isCenter: true
      },
      {
        pagePath: '/pages/notifications/index',
        text: '通知',
        iconPath: '/assets/bell.png',
        selectedIconPath: '/assets/bell-active.png'
      },
      {
        pagePath: '/pages/profile/index',
        text: '我的',
        iconPath: '/assets/profile.png',
        selectedIconPath: '/assets/profile-active.png'
      }
    ]
  }

  switchTab = (index: number, url: string) => {
    this.setState({ selected: index })
    Taro.switchTab({ url })
  }

  componentDidMount() {
    const page = Taro.getCurrentInstance().router
    const selected = this.state.list.findIndex(item =>
      page?.path.includes(item.pagePath.replace(/^\//, ''))
    )
    if (selected !== -1) {
      this.setState({ selected })
    }
    this.unsubscribe = unread.subscribe((count) => this.setState({ badge: badgeText(count.total) }))
  }

  componentWillUnmount() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  render() {
    const { selected, list, badge } = this.state

    return (
      <CoverView className='custom-tab-bar'>
        <CoverView className='tab-bar-container'>
          {list.map((item, index) => (
            <CoverView
              key={index}
              className={`tab-item ${item.isCenter ? 'tab-item-center' : ''}`}
              onClick={() => this.switchTab(index, item.pagePath)}
            >
              {item.isCenter ? (
                <CoverView className='center-button'>
                  <CoverImage
                    className='center-icon'
                    src={selected === index ? item.selectedIconPath : item.iconPath}
                  />
                </CoverView>
              ) : (
                <>
                  <CoverImage
                    className='tab-icon'
                    src={selected === index ? item.selectedIconPath : item.iconPath}
                  />
                  <CoverView
                    className='tab-text'
                    style={{ color: selected === index ? '#194e41' : '#7d857f' }}
                  >
                    {item.text}
                  </CoverView>
                  {item.pagePath === NOTIFICATIONS && badge ? (
                    <CoverView className='tab-badge'>{badge}</CoverView>
                  ) : null}
                </>
              )}
            </CoverView>
          ))}
        </CoverView>
      </CoverView>
    )
  }
}
