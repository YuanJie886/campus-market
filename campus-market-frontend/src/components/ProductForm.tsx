import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import type { Campus, Category, Condition, ProductInput } from "../types";
import { CAMPUSES, CATEGORIES, CONDITIONS } from "../types";
import {
  IMAGE_PRESETS,
  CATEGORY_EMOJI,
  CATEGORY_GRADIENT,
} from "../utils/constants";
import { useNotify } from "../context/NotificationContext";
import ImageWithFallback from "./ImageWithFallback";
import BuildingSelect from "./BuildingSelect";
import { getApiClient } from "../api/client";
import { toUserMessage } from "../api/errors";
import type { DisclosureInput, InspectionTemplate, ProductDisclosure, ProductTextbook } from "../api/contracts";
import TextbookIsbnField, { describeLinked, type LinkedTextbook } from "./textbook/TextbookIsbnField";
import InspectionDeclarationFields, {
  DECLARATION_NOTE_MAX,
  declarationFieldName,
  type DeclarationDraft,
  type DeclarationValue,
} from "./trust/InspectionDeclarationFields";
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from "./trust/ErrorSummary";
import VisibilityPicker from "./circle/VisibilityPicker";
import type { ProductVisibility } from "../api/contracts";

export interface ProductFormValue {
  title: string;
  description: string;
  price: string;
  originalPrice: string;
  category: Category;
  condition: Condition;
  campus: Campus;
  /** 取货楼栋。null 表示卖家明确选择了「不指定楼栋」。 */
  buildingId: string | null;
  contact: string;
  contactPublic: boolean;
  images: string[];
  /** 模块 6：可见范围。默认全校公开；圈子可见必须由卖家主动选择圈子 */
  visibility: ProductVisibility;
  circleIds: string[];
}

export const emptyProductForm: ProductFormValue = {
  title: "",
  description: "",
  price: "",
  originalPrice: "",
  category: "数码电子",
  condition: "几乎全新",
  campus: "东校区",
  buildingId: null,
  contact: "",
  contactPublic: false,
  images: [],
  visibility: "PUBLIC",
  circleIds: [],
};

interface ProductFormProps {
  initial?: Partial<ProductFormValue>;
  submitLabel?: string;
  /** 提交回调，不含 sellerId（由调用方补充） */
  onSubmit: (data: Omit<ProductInput, "sellerId">) => void | Promise<void>;
  onCancel?: () => void;
  /** 紧凑模式：用于弹窗内 */
  compact?: boolean;
  /** 编辑模式：会提示「商品声明以当前展示内容为准」，旧商品未声明时允许保持未声明 */
  mode?: "create" | "edit";
  /** 编辑时商品当前的声明（来自商品详情）；null 表示该商品从未提供声明 */
  initialInspection?: ProductDisclosure | null;
  /** 模块 4：编辑时商品当前关联的教材版本；null 表示未关联 */
  initialTextbook?: ProductTextbook | null;
  /** 4.8：从教材版本页进入发布时预先打开该版本的确认框（不会自动关联） */
  presetTextbookEditionId?: string | null;
}

const TEXTBOOK_CATEGORY: Category = "教材书籍";

/** 从已有声明恢复草稿：只恢复卖家真实填写过的条目，不补任何默认值。 */
function draftsFrom(disclosure: ProductDisclosure | null | undefined): DeclarationValue {
  const drafts: DeclarationValue = {};
  for (const item of disclosure?.items ?? []) {
    if (item.condition) drafts[item.code] = { condition: item.condition, note: item.note ?? "" };
  }
  return drafts;
}

const FIELD_IDS = {
  title: "product-form-title",
  description: "product-form-description",
  price: "product-form-price",
  contact: "product-form-contact",
  images: "product-form-images",
  circleIds: "product-form-visibility",
} as const;

type FieldErrors = Partial<
  Record<"title" | "description" | "price" | "contact" | "images" | "circleIds", string>
>;

/**
 * 商品表单：发布页与「编辑商品」弹窗共用。
 * 负责字段校验与图片选择（预置图片，不做真实文件上传）。
 */
export default function ProductForm({
  initial,
  submitLabel = "立即发布",
  onSubmit,
  onCancel,
  compact = false,
  mode = "create",
  initialInspection,
  initialTextbook,
  presetTextbookEditionId,
}: ProductFormProps) {
  const { error } = useNotify();
  const [value, setValue] = useState<ProductFormValue>({
    ...emptyProductForm,
    ...initial,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const initialCategory = useRef(value.category);
  // 模块 4：卖家主动确认的教材版本。切离教材分类时清空，不带到其他分类
  const [linkedTextbook, setLinkedTextbook] = useState<LinkedTextbook | null>(() =>
    initialTextbook ? { editionId: initialTextbook.editionId, label: describeLinked(initialTextbook) } : null,
  );

  // 验货模板随分类加载。undefined = 加载中；null = 该分类没有清单
  const [template, setTemplate] = useState<InspectionTemplate | null | undefined>(undefined);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const [declarations, setDeclarations] = useState<DeclarationValue>(() =>
    initialInspection && initialInspection.category === value.category ? draftsFrom(initialInspection) : {},
  );
  const [declarationErrors, setDeclarationErrors] = useState<Record<string, string>>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryItems, setSummaryItems] = useState<ErrorSummaryItem[]>([]);
  const [summaryFocusTick, setSummaryFocusTick] = useState(0);

  useEffect(() => {
    let active = true;
    setTemplate(undefined);
    setTemplateError(null);
    getApiClient()
      .getInspectionTemplate(value.category)
      .then((t) => {
        if (active) setTemplate(t);
      })
      .catch((e) => {
        if (active) setTemplateError(toUserMessage(e, "验货清单加载失败"));
      });
    return () => {
      active = false;
    };
  }, [value.category, templateAttempt]);

  // 提交失败后把焦点移到错误摘要（等摘要渲染出来之后）
  useEffect(() => {
    if (summaryFocusTick > 0) summaryRef.current?.focus();
  }, [summaryFocusTick]);

  const changeCategory = (category: Category) => {
    if (category === value.category) return;
    patch({ category });
    if (category !== TEXTBOOK_CATEGORY) setLinkedTextbook(null);
    // 切换分类：不同分类的条目不能互相复用。回到原分类时恢复的是该分类自己的已存声明
    setDeclarations(
      initialInspection && initialInspection.category === category ? draftsFrom(initialInspection) : {},
    );
    setDeclarationErrors({});
  };

  const changeDeclaration = (code: string, draft: DeclarationDraft) => {
    setDeclarations((prev) => ({ ...prev, [code]: draft }));
    setDeclarationErrors((prev) => {
      if (!prev[code]) return prev;
      const { [code]: _cleared, ...rest } = prev;
      return rest;
    });
  };

  const categoryChanged = value.category !== initialCategory.current;
  const anyDeclared = Object.values(declarations).some((d) => d.condition);
  // 旧商品（从未声明）只改其他字段时允许继续保持「未声明」，不强迫补填，也不替它伪造
  const declarationRequired =
    mode === "create" || categoryChanged || Boolean(initialInspection) || anyDeclared;

  const patch = (partial: Partial<ProductFormValue>) => {
    setValue((prev) => ({ ...prev, ...partial }));
  };

  const toggleImage = (url: string) => {
    setValue((prev) => {
      const exists = prev.images.includes(url);
      if (exists) {
        return { ...prev, images: prev.images.filter((i) => i !== url) };
      }
      if (prev.images.length >= 5) {
        error("最多选择 5 张图片");
        return prev;
      }
      return { ...prev, images: [...prev.images, url] };
    });
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const nextDeclarationErrors: Record<string, string> = {};
    if (template && declarationRequired) {
      for (const item of template.items) {
        const draft = declarations[item.code];
        if (item.required && !draft?.condition) nextDeclarationErrors[item.code] = `请为「${item.label}」选择一项`;
        else if (draft?.note && draft.note.trim().length > DECLARATION_NOTE_MAX)
          nextDeclarationErrors[item.code] = `说明最多 ${DECLARATION_NOTE_MAX} 个字`;
        else if (draft?.note && /[<>]/.test(draft.note)) nextDeclarationErrors[item.code] = "说明不能包含尖括号";
      }
    }
    if (!value.title.trim()) next.title = "请输入商品标题";
    else if (value.title.trim().length < 4) next.title = "标题至少 4 个字";

    if (!value.description.trim()) next.description = "请输入商品描述";
    else if (value.description.trim().length < 10)
      next.description = "描述至少 10 个字，便于买家了解";

    const priceNum = Number(value.price);
    if (value.price === "" || Number.isNaN(priceNum)) next.price = "请输入价格";
    else if (priceNum <= 0) next.price = "价格必须大于 0";
    else if (priceNum > 1000000) next.price = "价格过于离谱啦";

    if (!value.contact.trim()) next.contact = "请输入联系方式";
    else if (value.contact.trim().length > 100) next.contact = "联系方式最多 100 个字";

    if (value.images.length === 0) next.images = "请至少选择一张商品图片";
    if (value.visibility === "CIRCLE_ONLY" && value.circleIds.length === 0)
      next.circleIds = "圈子可见需要至少选择一个圈子";

    setErrors(next);
    setDeclarationErrors(nextDeclarationErrors);
    const focusById = (id: string) => () => document.getElementById(id)?.focus();
    const items: ErrorSummaryItem[] = [
      ...(Object.keys(next) as (keyof FieldErrors)[]).map((key) => ({
        key,
        message: next[key]!,
        focus: focusById(FIELD_IDS[key]),
      })),
      ...(template?.items ?? [])
        .filter((item) => nextDeclarationErrors[item.code])
        .map((item) => ({
          key: `decl-${item.code}`,
          message: nextDeclarationErrors[item.code],
          focus: () => focusRadioGroup(declarationFieldName(item.code)),
        })),
    ];
    setSummaryItems(items);
    return items.length === 0;
  };

  /** 只提交 itemCode / condition / note 三个字段；未声明的选填项不提交。 */
  const disclosurePayload = (): DisclosureInput[] | undefined => {
    if (!template || !declarationRequired) return undefined;
    return template.items
      .filter((item) => declarations[item.code]?.condition)
      .map((item) => {
        const draft = declarations[item.code];
        const note = draft.note.trim();
        return { itemCode: item.code, condition: draft.condition!, ...(note ? { note } : {}) };
      });
  };

  const [submitting, setSubmitting] = useState(false);
  // 只为「发布前告诉用户将公开哪一栋楼」这一句提示而缓存楼栋名。
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    getApiClient()
      .listBuildings(value.campus)
      .then((list) => {
        if (!active) return;
        setBuildingNames(Object.fromEntries(list.map((b) => [b.id, `${b.zone} · ${b.name}`])));
      })
      .catch(() => undefined);   // 提示文案降级为通用说法即可，不打扰用户
    return () => {
      active = false;
    };
  }, [value.campus]);
  const buildingLabelOf = (id: string) => buildingNames[id] ?? "所选楼栋";
  const handleSubmit = async () => {
    if (submitting) return;
    if (template === undefined) {
      error(templateError ?? "验货清单仍在加载，请稍候");
      return;
    }
    if (!validate()) {
      error("请检查表单中标红的字段");
      setSummaryFocusTick((n) => n + 1);
      return;
    }
    const inspection = disclosurePayload();
    // 教材版本：新建时只在确认了版本后提交；编辑时只在变化时提交（null 表示解除关联）。
    // 切到其他分类时不提交，服务端会自动解除原关联。
    let textbookEditionId: string | null | undefined;
    if (value.category === TEXTBOOK_CATEGORY) {
      if (mode === "create") textbookEditionId = linkedTextbook?.editionId;
      else if ((linkedTextbook?.editionId ?? null) !== (initialTextbook?.editionId ?? null)) {
        textbookEditionId = linkedTextbook?.editionId ?? null;
      }
    }
    // 可见范围：新建时总是提交；编辑时只在变化时提交（整体替换）
    const initialVisibility = initial?.visibility ?? "PUBLIC";
    const initialCircleIds = [...(initial?.circleIds ?? [])].sort().join(",");
    const visibilityChanged =
      value.visibility !== initialVisibility || [...value.circleIds].sort().join(",") !== initialCircleIds;
    const visibilityFields =
      mode === "create" || visibilityChanged
        ? { visibility: value.visibility, ...(value.visibility === "CIRCLE_ONLY" ? { circleIds: value.circleIds } : {}) }
        : {};
    const originalPriceNum =
      value.originalPrice === "" ? undefined : Number(value.originalPrice);
    setSubmitting(true);
    try {
      await onSubmit({
        title: value.title.trim(),
        description: value.description.trim(),
        price: Number(value.price),
        originalPrice:
          originalPriceNum !== undefined && !Number.isNaN(originalPriceNum)
            ? originalPriceNum
            : undefined,
        category: value.category,
        condition: value.condition,
        campus: value.campus,
        buildingId: value.buildingId,
        images: value.images,
        contact: value.contact.trim(),
        contactPublic: value.contactPublic,
        // 只在需要时带上该键：缺省表示「不改动声明」，与显式提交空声明语义不同
        ...(inspection ? { inspection } : {}),
        ...(textbookEditionId !== undefined ? { textbookEditionId } : {}),
        ...visibilityFields,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={compact ? 2 : 2.5}>
      <ErrorSummary ref={summaryRef} title="提交前请先修正以下问题" items={summaryItems} />
      <TextField
        id={FIELD_IDS.title}
        label="商品标题"
        placeholder="例如：iPhone 13 128G 蓝色 国行"
        value={value.title}
        onChange={(e) => patch({ title: e.target.value })}
        error={Boolean(errors.title)}
        helperText={errors.title ?? "一句话说清楚是什么，更容易被搜到"}
        fullWidth
        required
      />

      <TextField
        id={FIELD_IDS.description}
        label="商品描述"
        placeholder="成色、入手时间、使用情况、配件是否齐全、其他补充信息…"
        value={value.description}
        onChange={(e) => patch({ description: e.target.value })}
        error={Boolean(errors.description)}
        helperText={errors.description}
        multiline
        minRows={compact ? 3 : 4}
        fullWidth
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id={FIELD_IDS.price}
          label="出售价格（元）"
          type="number"
          value={value.price}
          onChange={(e) => patch({ price: e.target.value })}
          error={Boolean(errors.price)}
          helperText={errors.price}
          inputProps={{ min: 0, step: 1 }}
          fullWidth
          required
        />
        <TextField
          label="原价（元，选填）"
          type="number"
          value={value.originalPrice}
          onChange={(e) => patch({ originalPrice: e.target.value })}
          helperText="填写后可展示划线原价，更有吸引力"
          inputProps={{ min: 0, step: 1 }}
          fullWidth
        />
      </div>
      {/* 模块 5.6：校内历史成交参考（只是统计，不是估价；价格由卖家自己决定） */}


      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField
          select
          label="分类"
          value={value.category}
          onChange={(e) => changeCategory(e.target.value as Category)}
          fullWidth
        >
          {CATEGORIES.map((c) => (
            <MenuItem key={c} value={c}>
              {CATEGORY_EMOJI[c]} {c}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="成色"
          value={value.condition}
          onChange={(e) => patch({ condition: e.target.value as Condition })}
          fullWidth
        >
          {CONDITIONS.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="交易地点（校区）"
          value={value.campus}
          onChange={(e) => patch({ campus: e.target.value as Campus })}
          fullWidth
        >
          {CAMPUSES.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">取货楼栋（选填）</p>
        <BuildingSelect
          campus={value.campus}
          value={value.buildingId}
          onChange={(buildingId) => patch({ buildingId })}
          emptyLabel="不指定楼栋"
          zoneLabel="取货园区"
          buildingLabel="取货楼栋"
        />
        {/* 发布前把将要公开的内容原样说清楚，避免默认预填变成「悄悄公开了我住哪」 */}
        <p className="mt-2 text-xs text-slate-500">
          {value.buildingId
            ? `买家会在商品页看到：${buildingLabelOf(value.buildingId)}。`
            : "不指定楼栋时，买家只会看到校区。"}
        </p>
      </div>

      {value.category === TEXTBOOK_CATEGORY && (
        <TextbookIsbnField
          value={linkedTextbook}
          onChange={setLinkedTextbook}
          editing={mode === "edit"}
          initial={initialTextbook ?? null}
          presetEditionId={mode === "create" ? presetTextbookEditionId ?? null : null}
        />
      )}

      {templateError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => setTemplateAttempt((n) => n + 1)}>
              重试
            </Button>
          }
        >
          {templateError}
        </Alert>
      )}
      {template === undefined && !templateError && (
        <p className="text-xs text-slate-600" role="status">正在加载该分类的验货清单…</p>
      )}
      {template === null && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          该分类暂无结构化验货清单，可以直接发布。
        </p>
      )}
      {template && (
        <>
          {mode === "edit" && !initialInspection && !categoryChanged && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
              该商品发布时未提供结构化验货声明。可以现在补充；不补充也能继续交易，买家会看到「未提供声明」。
            </p>
          )}
          <InspectionDeclarationFields
            template={template}
            value={declarations}
            errors={declarationErrors}
            onChange={changeDeclaration}
            editing={mode === "edit"}
          />
        </>
      )}

      <TextField
        id={FIELD_IDS.contact}
        label="联系方式"
        placeholder="手机号、微信号或其他联系方式"
        inputProps={{ maxLength: 100 }}
        value={value.contact}
        onChange={(e) => patch({ contact: e.target.value })}
        error={Boolean(errors.contact)}
        helperText={errors.contact ?? "由你选择公开展示，或同意买家的联系申请后展示"}
        fullWidth
        required
      />

      <FormControlLabel control={<Checkbox checked={value.contactPublic} onChange={(e) => patch({ contactPublic: e.target.checked })} />}
        label="公开展示联系方式" />
      <p className="text-xs text-slate-500">未勾选时，买家需要点击“我想要”，经你同意后才能查看联系方式。平台只展示商品和联系方式，后续沟通与交易由双方自行联系。</p>
      {/* 图片选择器 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: "text.secondary" }}
          >
            商品图片（{value.images.length}/5）
          </Typography>
          {errors.images && (
            <Typography variant="caption" color="error">
              {errors.images}
            </Typography>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {IMAGE_PRESETS.map((url, index) => {
            const selected = value.images.includes(url);
            return (
              <button
                key={url}
                id={index === 0 ? FIELD_IDS.images : undefined}
                type="button"
                onClick={() => toggleImage(url)}
                className={`relative overflow-hidden rounded-xl border-2 transition ${
                  selected
                    ? "border-brand-500 ring-2 ring-brand-200"
                    : "border-transparent"
                }`}
                aria-label={`选择图片 ${index + 1}`}
                aria-pressed={selected}
              >
                <ImageWithFallback
                  src={url}
                  alt={`预置图片 ${index + 1}`}
                  emoji={CATEGORY_EMOJI[value.category]}
                  gradient={CATEGORY_GRADIENT[value.category]}
                  className="aspect-square w-full"
                />
                {/* 纯视觉标记：选中状态已由按钮的 aria-pressed 表达，不能在按钮里再嵌一个可交互的复选框 */}
                <span
                  aria-hidden="true"
                  className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    selected ? "border-white bg-brand-600 text-white" : "border-white bg-black/20 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked disabled />}
          label={
            <span className="text-xs text-slate-400">
              演示版使用预置图片，不支持真实文件上传
            </span>
          }
        />
      </div>

      <div id={FIELD_IDS.circleIds} tabIndex={-1}>
        <VisibilityPicker
          visibility={value.visibility}
          circleIds={value.circleIds}
          onChange={(next) => {
            patch(next);
            if (errors.circleIds) setErrors(({ circleIds: _cleared, ...rest }) => rest);
          }}
          error={errors.circleIds}
        />
        {mode === "edit" && (
          <p className="mt-1 text-xs text-slate-600">
            改成圈子可见后，不在所选圈子里的同学将看不到这件商品（包括已收藏和已发起的会话）；联系申请的查看同样受商品可见范围限制。
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button onClick={onCancel} color="inherit">
            取消
          </Button>
        )}
        <Button
          variant="contained"
          size="large"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitLabel}
        </Button>
      </div>
    </Stack>
  );
}
