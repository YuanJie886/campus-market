import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { Category, Campus, FilterState } from "../types";
import { CAMPUSES, CATEGORIES } from "../types";
import { useAuth } from "../context/AuthContext";
import { useAuthGate } from "../hooks/useAuthGate";
import { useNotify } from "../context/NotificationContext";
import { getApiClient } from "../api/client";

interface Props {
  initial: FilterState;
}

export default function DemandSubscriptionDialog({ initial }: Props) {
  const { currentUser } = useAuth();
  const authGate = useAuthGate();
  const { success, error } = useNotify();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState(initial.keyword);
  const [category, setCategory] = useState<Category | "全部">(initial.category);
  const [campus, setCampus] = useState<Campus | "全部">(initial.campus);
  const [minPrice, setMinPrice] = useState(initial.minPrice === "" ? "" : String(initial.minPrice));
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice === "" ? "" : String(initial.maxPrice));

  const openDialog = () => {
    setKeyword(initial.keyword);
    setCategory(initial.category);
    setCampus(initial.campus);
    setMinPrice(initial.minPrice === "" ? "" : String(initial.minPrice));
    setMaxPrice(initial.maxPrice === "" ? "" : String(initial.maxPrice));
    authGate(() => setOpen(true));
  };

  const save = async () => {
    if (busy) return;
    const min = minPrice === "" ? undefined : Number(minPrice);
    const max = maxPrice === "" ? undefined : Number(maxPrice);
    if ((min !== undefined && (!Number.isFinite(min) || min < 0)) || (max !== undefined && (!Number.isFinite(max) || max < 0))) {
      error("预算请输入有效的非负金额");
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      error("最低预算不能高于最高预算");
      return;
    }
    setBusy(true);
    try {
      await getApiClient().createDemandSubscription({
        keyword: keyword.trim(),
        category: category === "全部" ? undefined : category,
        campus: campus === "全部" ? undefined : campus,
        minPrice: min,
        maxPrice: max,
      });
      success("需求条件已保存，可在个人中心查看匹配商品");
      setOpen(false);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="contained" onClick={openDialog}>
        保存需求条件
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>保存需求条件</DialogTitle>
        <DialogContent className="!pt-2">
          <p className="mb-4 text-sm text-slate-500">
            规则会按关键词、分类、校区和预算筛选当前在售商品。保存后可在个人中心查看匹配结果；此版本不会发送推送通知。
          </p>
          <div className="flex flex-col gap-3">
            <TextField label="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} inputProps={{ maxLength: 128 }} fullWidth />
            <TextField select label="分类" value={category} onChange={(e) => setCategory(e.target.value as Category | "全部")} fullWidth>
              <MenuItem value="全部">不限</MenuItem>
              {CATEGORIES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
            </TextField>
            <TextField select label="校区" value={campus} onChange={(e) => setCampus(e.target.value as Campus | "全部")} fullWidth>
              <MenuItem value="全部">不限</MenuItem>
              {CAMPUSES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
            </TextField>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="最低预算" type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputProps={{ min: 0, step: 1 }} />
              <TextField label="最高预算" type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputProps={{ min: 0, step: 1 }} />
            </div>
          </div>
        </DialogContent>
        <DialogActions className="!px-6 !pb-5">
          <Button color="inherit" onClick={() => setOpen(false)}>取消</Button>
          <Button variant="contained" onClick={save} disabled={busy || !currentUser}>
            {busy ? "保存中…" : "保存条件"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
