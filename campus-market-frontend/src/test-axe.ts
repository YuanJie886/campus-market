import axe from 'axe-core';

/**
 * 在 jsdom 里运行 axe-core，返回违规项。
 *
 * <p>jsdom 不做布局与渲染，axe 中依赖真实渲染的规则在这里没有意义，
 * 因此关闭：color-contrast（算不出颜色）。其余结构性规则（可访问名称、
 * label 关联、ARIA 属性合法性、重复 id、列表结构等）照常检查。
 *
 * <p>自动化检查只能发现一部分问题，<b>不等于</b> WCAG 合规；
 * 键盘操作与读屏体验另有专门的交互测试。
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 全部违规（含 moderate / minor），仅用于报告，不作为失败条件。 */
export async function axeAllViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  return result.violations.map((v) => `${v.id} (${v.impact})`);
}
