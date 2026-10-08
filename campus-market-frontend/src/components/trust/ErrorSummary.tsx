import { forwardRef } from 'react';

export interface ErrorSummaryItem { key: string; message: string; focus: () => void }

/**
 * 提交失败时的错误摘要。调用方在提交失败后把焦点移到这里（tabIndex=-1），
 * 读屏会读出标题与条目数；每一条都能直接把焦点带到对应字段。
 * 焦点移动本身就会朗读，因此这里不再叠加 role="alert"。
 */
const ErrorSummary = forwardRef<HTMLDivElement, { title: string; items: ErrorSummaryItem[] }>(
  function ErrorSummary({ title, items }, ref) {
    if (!items.length) return null;
    return (
      <div
        ref={ref}
        tabIndex={-1}
        aria-labelledby="error-summary-title"
        className="rounded-xl border-2 border-red-600 bg-red-50 p-3 outline-none focus:ring-2 focus:ring-red-400"
      >
        <p id="error-summary-title" className="text-sm font-bold text-red-800">
          {title}（{items.length} 项）
        </p>
        <ul className="mt-1 list-disc pl-5 text-sm text-red-800">
          {items.map((item) => (
            <li key={item.key}>
              <button type="button" className="text-left underline" onClick={item.focus}>
                {item.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);

export default ErrorSummary;

/** 把焦点移到某个单选组被选中的选项，未选时移到第一个选项。 */
export function focusRadioGroup(name: string): void {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));
  (inputs.find((i) => i.checked) ?? inputs[0])?.focus();
}
