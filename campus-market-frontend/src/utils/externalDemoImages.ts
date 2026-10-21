/**
 * 外部演示图片：整个网页端源码里**唯一**允许出现第三方演示图床主机名的文件。
 *
 * - IMAGE_PRESETS：发布页的预置示例图（过渡期保留）。只经过 ImageUploader 渲染，而 ImageUploader 只在
 *   GET /v1/config 明确返回 images.externalAllowed=true 时才显示它们（配置加载中、加载失败都不显示），
 *   因此 externalAllowed=false 的 REST 部署不会向这个主机发出任何请求。
 * - isLegacyDemoImage：旧的演示数据里的头像（…/seed/…）一律当作「没有头像」，从不加载。
 *
 * scripts/check-bundles.mjs 检查 REST 产物里这个主机名只以上面两种形式出现；
 * src/thirdPartyHosts.test.ts 检查其他源文件不出现这个主机名。
 */
export const EXTERNAL_DEMO_HOST = 'picsum.photos';

/** 发布页可选的预置示例图（外部占位图，过渡期保留；真实图片通过上传）。只在 externalAllowed=true 时显示 */
export const IMAGE_PRESETS: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  `https://${EXTERNAL_DEMO_HOST}/seed/cm-preset-${i + 1}/600/600`,
);

/** 指向演示图床（含子域名）的 http(s) 地址：旧演示数据，不加载 */
export function isLegacyDemoImage(value: string | null | undefined): boolean {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === EXTERNAL_DEMO_HOST || host.endsWith(`.${EXTERNAL_DEMO_HOST}`);
  } catch {
    return false;
  }
}
