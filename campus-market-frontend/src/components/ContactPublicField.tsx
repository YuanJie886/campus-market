import { useId } from 'react';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';

/**
 * 「公开展示联系方式」开关（单件、整套打包、批量发布共用）。默认不勾选。
 * 说明文字必须如实写出勾选的后果（docs/contact-display-model.md「勾选的后果」），并通过 aria-describedby 关联到复选框。
 */
export const CONTACT_PUBLIC_CONSEQUENCE =
  '勾选后，你填写的联系方式会随商品一起出现在商品详情、商品列表与搜索结果、楼栋动态和需求匹配收件箱里，'
  + '所有能看到这件商品的本校登录同学都能直接看到，不需要申请；商品原有的学校、圈子与可见范围不变。'
  + '可以随时取消勾选，取消后只有你本人和已获你同意（且未被撤回）的买家能看到。';
export const CONTACT_PRIVATE_NOTE = '不勾选时，买家需要点击“我想要”提交申请，经你同意后才能看到联系方式。平台只展示商品和联系方式，后续沟通与交易由双方自行联系。';

export default function ContactPublicField({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const helpId = useId();
  return (
    <div>
      <FormControlLabel
        control={<Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} inputProps={{ 'aria-describedby': helpId }} />}
        label="公开展示联系方式"
      />
      <div id={helpId} className="space-y-1 text-xs text-slate-600">
        <p>{CONTACT_PUBLIC_CONSEQUENCE}</p>
        <p>{CONTACT_PRIVATE_NOTE}</p>
      </div>
    </div>
  );
}
