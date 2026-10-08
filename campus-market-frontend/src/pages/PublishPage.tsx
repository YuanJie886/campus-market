import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Button from "@mui/material/Button";
import BundleProductForm from "../components/supply/BundleProductForm";
import ProductForm from "../components/ProductForm";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { useNotify } from "../context/NotificationContext";
import type { ProductInput } from "../types";
import { toUserMessage } from '../api/errors';

/** 发布商品页 */
export default function PublishPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { addProduct } = useMarket();
  const { success, error } = useNotify();
  // 从教材版本页进入：只是预先打开该版本的确认框，是否关联仍由卖家决定
  const [params] = useSearchParams();
  const presetEditionId = params.get("textbookEditionId");
  // 5.4：单件 / 整套打包。默认单件；整套打包是卖家主动选择的发布方式
  const [kind, setKind] = useState<"SINGLE" | "BUNDLE">("SINGLE");

  const handleSubmit = async (data: Omit<ProductInput, "sellerId">) => {
    try {
      if (!currentUser) {
        error("登录状态已失效，请重新登录");
        navigate("/login");
        return;
      }
      const product = await addProduct({ ...data, sellerId: currentUser.id });
      success("发布成功，快去看看你的宝贝吧～");
      navigate(`/product/${product.id}`);
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 md:text-2xl">
          发布闲置
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          信息越详细，越容易遇到有缘的买家～
        </p>
        <p className="mt-1 text-sm">
          <Link to="/publish/batch" className="text-teal-800 underline">一次发布多件？使用毕业季快速发布</Link>
        </p>
      </div>
      <div role="group" aria-labelledby="listing-kind-label" className="mb-3 flex flex-wrap items-center gap-2">
        <span id="listing-kind-label" className="text-sm font-semibold text-slate-700">发布方式</span>
        {([["SINGLE", "单件"], ["BUNDLE", "整套打包"]] as const).map(([value, label]) => (
          <Button key={value} size="small" variant={kind === value ? "contained" : "outlined"} aria-pressed={kind === value}
            onClick={() => setKind(value)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        {kind === "BUNDLE" ? (
          <BundleProductForm
            initial={{ contact: currentUser?.contact ?? "", campus: currentUser?.campus ?? "东校区", buildingId: currentUser?.dormBuildingId ?? null }}
            onSubmit={handleSubmit}
            onCancel={() => navigate(-1)}
          />
        ) : (
        <ProductForm
          initial={{
            contact: currentUser?.contact ?? "",
            campus: currentUser?.campus ?? "东校区",
            // 预填本人宿舍楼只是省一步操作：表单下方会明确写出将公开哪一栋楼，
            // 用户随时可以改成别的楼或「不指定楼栋」
            buildingId: currentUser?.dormBuildingId ?? null,
            ...(presetEditionId ? { category: "教材书籍" as const } : {}),
          }}
          presetTextbookEditionId={presetEditionId}
          submitLabel="立即发布"
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
        )}
      </div>
    </div>
  );
}
