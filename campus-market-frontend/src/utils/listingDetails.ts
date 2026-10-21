import type { Category } from "../types";

/** Rule-based listing nudges. These only identify missing mentions; they never assert product condition. */
export function getMissingListingDetails(
  category: Category,
  title: string,
  description: string,
): string[] {
  const text = `${title} ${description}`.toLocaleLowerCase();
  const missing: string[] = [];

  if (category === "教材书籍" && !/(版|isbn|版本)/i.test(text)) {
    missing.push("教材版次或 ISBN 是否匹配");
  }

  if (/(耳机|airpods|headset)/i.test(text) && !/(充电盒|耳机盒|盒子)/i.test(text)) {
    missing.push("是否包含充电盒");
  }

  if (/(台灯|灯具|小夜灯)/i.test(text) && !/(电源|适配器|充电线|电源线)/i.test(text)) {
    missing.push("电源或连接线是否齐全");
  }

  if (category === "数码电子" && !/(维修|拆修|未修|没修过|无维修)/i.test(text)) {
    missing.push("是否有维修或拆修经历");
  }

  return missing;
}
