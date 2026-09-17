import { useEffect, useState } from 'react';

interface ImageWithFallbackProps {
  /** 图片地址，可能为空 */
  src?: string;
  alt: string;
  /** 加载失败时展示的 emoji */
  emoji?: string;
  /** 加载失败 / 加载中时的渐变背景 */
  gradient?: string;
  /** 外层容器附加类名（用于控制尺寸） */
  className?: string;
  /** img 元素附加类名 */
  imgClassName?: string;
}

/**
 * 带加载中骨架与失败兜底的图片组件。
 * 图片加载失败时回退为「渐变背景 + emoji」，保证任何情况下 UI 都不破图。
 */
export default function ImageWithFallback({
  src,
  alt,
  emoji = '🖼️',
  gradient = 'linear-gradient(135deg,#e2e8f0 0%,#cbd5e1 100%)',
  className = '',
  imgClassName = '',
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const showFallback = failed || !src;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: gradient }}
    >
      {!showFallback && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      )}

      {!showFallback && !loaded && (
        <div
          className="absolute inset-0 animate-pulse"
          style={{ background: gradient, opacity: 0.5 }}
        />
      )}

      {showFallback && (
        <div className="flex h-full w-full items-center justify-center">
          <span className="select-none text-4xl opacity-80" aria-hidden="true">
            {emoji}
          </span>
        </div>
      )}
    </div>
  );
}
