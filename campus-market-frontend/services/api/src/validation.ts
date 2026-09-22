import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export const campus = z.enum(["东校区", "西校区", "南校区", "北校区"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const image = z
  .string()
  .max(2048)
  .refine((v) => /^https?:\/\//.test(v), "图片必须使用 HTTP(S) 地址");
export const registerSchema = z.object({
  account: text(64).regex(/^[\w@.+-]+$/),
  password: z.string().min(8).max(72),
  nickname: text(40),
  campus,
  contact: z.string().trim().max(100).default(""),
});
export const loginSchema = z.object({
  account: text(64),
  password: z.string().min(1).max(72),
});
export const profileSchema = z
  .object({
    nickname: text(40).optional(),
    avatar: image.or(z.literal("")).optional(),
    campus: campus.optional(),
    contact: z.string().trim().max(100).optional(),
  })
  .strict();
export const productSchema = z
  .object({
    title: text(100),
    description: text(4000),
    price: z
      .number()
      .finite()
      .min(0)
      .max(99999999)
      .refine(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
        "价格最多两位小数",
      ),
    originalPrice: z.number().min(0).max(99999999).optional(),
    category: z.enum([
      "数码电子",
      "教材书籍",
      "生活用品",
      "服饰鞋包",
      "运动户外",
      "其他",
    ]),
    condition: z.enum(["全新", "几乎全新", "轻微使用痕迹", "明显使用痕迹"]),
    campus,
    images: z.array(image).max(9),
    contact: z.string().trim().max(100).default(""),
  })
  .strict();
export const orderSchema = z
  .object({
    productId: z.uuid(),
    meetingPointId: text(100),
    meetingAtIso: z.iso.datetime({ offset: true }),
    contact: text(100),
    idempotencyKey: text(100),
  })
  .strict();
export const transitionSchema = z
  .object({
    to: z.enum([
      "PENDING_MEETING",
      "BUYER_CONFIRMED",
      "COMPLETED",
      "CANCELLED",
    ]),
    confirmationCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();
export const reviewSchema = z
  .object({ rating: z.number().int().min(1).max(5), comment: text(1000) })
  .strict();
export const contentSchema = z
  .object({ content: text(2000), parentId: z.uuid().nullable().optional() })
  .strict();
export const querySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  category: productSchema.shape.category.optional(),
  campus: campus.optional(),
  condition: productSchema.shape.condition.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["latest", "priceAsc", "priceDesc", "views"]).default("latest"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return r.data;
}
export function id(value: string) {
  return parse(z.uuid(), value);
}
