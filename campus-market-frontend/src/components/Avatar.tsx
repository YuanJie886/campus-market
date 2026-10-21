import { useEffect, useState, type CSSProperties } from 'react';
import { avatarAppearance, avatarInitial } from '../utils/avatar';
import { resolveImageSrc } from '../utils/images';

interface AvatarProps {
  /** 头像值："preset:N"、签名的相对地址、http(s)、""（以及旧演示数据，按 "" 处理） */
  avatar?: string | null;
  /** 昵称：预设头像上画它的首字（空时为「同」） */
  nickname?: string | null;
  /** 用户 id：没有头像或图片加载失败时，由它确定使用哪个预设 */
  userId?: string | null;
  /** 直径（px） */
  size?: number;
  /** 可访问名称；不传表示装饰性（旁边已经有昵称文字），读屏跳过 */
  alt?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * 网页端唯一的头像组件（导航栏、个人中心、资料编辑、商品详情的卖家与留言、私信）。
 * 预设头像与兜底头像都在本地绘制（底色 + 白色昵称首字），不请求任何外部主机；
 * 旧演示数据里的外部头像从不加载。
 */
export default function Avatar({ avatar, nickname, userId, size = 40, alt, className = '', style }: AvatarProps) {
  const look = avatarAppearance(avatar, userId);
  const src = look.kind === 'image' ? resolveImageSrc(look.src) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const decorative = alt === undefined;
  const base: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style,
  };

  if (look.kind === 'image' && src && !failed) {
    return (
      <img
        src={src}
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        data-avatar-kind="image"
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={className}
        style={{ ...base, objectFit: 'cover', background: look.fallbackColor }}
      />
    );
  }

  const preset = look.kind === 'preset' ? look.preset : look.fallbackPreset;
  const color = look.kind === 'preset' ? look.color : look.fallbackColor;
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative || undefined}
      data-avatar-kind="preset"
      data-avatar-preset={preset}
      className={className}
      style={{ ...base, backgroundColor: color, color: '#FFFFFF', fontWeight: 700, fontSize: Math.round(size * 0.45), lineHeight: 1, userSelect: 'none' }}
    >
      <span aria-hidden="true">{avatarInitial(nickname)}</span>
    </span>
  );
}
