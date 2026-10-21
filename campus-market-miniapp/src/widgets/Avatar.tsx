import { Image, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { imageSrc } from '../api';
import { avatarView } from '../avatar';
import { useClientConfig } from '../state';

/**
 * 全站唯一的头像组件（规则见 src/avatar.ts）：预设、空头像与网页端旧账号的外部默认头像一律本地绘制
 * （色板背景 + 昵称第一个字），不请求任何第三方图片服务；本人上传的头像显示签名地址，加载失败时退回绘制。
 * preview 只用于编辑资料时刚选好、还没保存的本机图片。
 */
export function Avatar({ value, userId, nickname, size = 'medium', preview }: { value?: string | null; userId?: string | null; nickname?: string | null; size?: 'small' | 'medium' | 'large'; preview?: string }) {
  const config = useClientConfig();
  const [failed, setFailed] = useState('');
  const view = avatarView(value, { userId, nickname, externalAllowed: config?.images.externalAllowed === true, resolve: imageSrc });
  const src = preview || (view.kind === 'image' ? view.src : '');
  if (src && failed !== src) return <Image className={`avatar avatar-${size}`} src={src} mode='aspectFill' onError={() => setFailed(src)} />;
  const drawn = view.kind === 'drawn' ? view : avatarView('', { userId, nickname, externalAllowed: false, resolve: () => '' });
  if (drawn.kind !== 'drawn') return null;
  return <View className={`avatar avatar-${size} avatar-drawn`} style={{ backgroundColor: drawn.color }}><Text className='avatar-initial'>{drawn.initial}</Text></View>;
}
