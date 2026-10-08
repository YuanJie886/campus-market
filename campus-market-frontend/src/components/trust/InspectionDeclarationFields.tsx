import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import type { DeclaredCondition, InspectionTemplate } from '../../api/contracts';
import { DECLARED_CONDITION_OPTIONS, conditionLabel } from '../../utils/trustedFlow';

export interface DeclarationDraft { condition?: DeclaredCondition; note: string }
export type DeclarationValue = Record<string, DeclarationDraft>;

export const DECLARATION_NOTE_MAX = 200;

/** 每个条目单选组的 name；错误摘要据此把焦点移到该组第一个选项。 */
export const declarationFieldName = (code: string) => `decl-${code}`;

interface Props {
  template: InspectionTemplate;
  value: DeclarationValue;
  errors: Record<string, string>;
  onChange: (code: string, draft: DeclarationDraft) => void;
  /** 编辑已有商品时提示：修改只影响之后生成的订单 */
  editing?: boolean;
}

/**
 * 卖家发布声明。每一项都是独立的单选组，<b>没有默认值</b>：
 * 不能替卖家预先勾选「正常」，否则声明就不再是卖家本人的陈述。
 */
export default function InspectionDeclarationFields({ template, value, errors, onChange, editing }: Props) {
  return (
    <section aria-labelledby="declaration-title" className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <div>
        <h2 id="declaration-title" className="text-sm font-bold text-slate-800">
          {template.title}（第 {template.version} 版）
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          逐项说明商品现状，买家会在面交时对照检查。这是双方的过程记录，不是平台鉴定或担保。
        </p>
      </div>
      {editing && (
        <Alert severity="info" role="note" sx={{ py: 0 }}>
          修改声明只影响之后生成的订单；已有订单保存的是下单时的验货快照，不会随之改变。
        </Alert>
      )}
      {template.items.map((item) => {
        const draft = value[item.code] ?? { note: '' };
        const error = errors[item.code];
        const legendId = `decl-legend-${item.code}`;
        const helpId = `decl-help-${item.code}`;
        return (
          <FormControl
            key={item.code}
            component="fieldset"
            error={Boolean(error)}
            fullWidth
            className="rounded-xl bg-slate-50 p-3"
          >
            <legend id={legendId} className="text-sm font-semibold text-slate-800">
              {item.label}
              <span className="ml-1 text-xs font-normal text-slate-600">{item.required ? '（必填）' : '（选填）'}</span>
            </legend>
            {item.description && <p className="text-xs text-slate-600">{item.description}</p>}
            <RadioGroup
              row
              name={declarationFieldName(item.code)}
              value={draft.condition ?? ''}
              aria-labelledby={legendId}
              aria-describedby={error ? helpId : undefined}
              onChange={(e) => onChange(item.code, { ...draft, condition: e.target.value as DeclaredCondition })}
            >
              {DECLARED_CONDITION_OPTIONS.map((option) => (
                <FormControlLabel
                  key={option}
                  value={option}
                  control={<Radio size="small" />}
                  label={conditionLabel(option)}
                />
              ))}
            </RadioGroup>
            {draft.condition && (
              <TextField
                size="small"
                label={draft.condition === 'DEFECT' ? '问题说明（建议简短写清）' : '补充说明（选填）'}
                value={draft.note}
                onChange={(e) => onChange(item.code, { ...draft, note: e.target.value })}
                inputProps={{ maxLength: DECLARATION_NOTE_MAX }}
                helperText={`${draft.note.length}/${DECLARATION_NOTE_MAX}`}
                fullWidth
                sx={{ mt: 1 }}
              />
            )}
            {error && <FormHelperText id={helpId}>{error}</FormHelperText>}
          </FormControl>
        );
      })}
    </section>
  );
}
