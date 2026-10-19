import { Component } from 'react'
import Taro from '@tarojs/taro'
import { CoverView, CoverImage } from '@tarojs/components'
import './index.scss'

export default class CustomTabBar extends Component {
  state = {
    selected: 0,
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
  }

  render() {
    const { selected, list } = this.state

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
                </>
              )}
            </CoverView>
          ))}
        </CoverView>
      </CoverView>
    )
  }
}
