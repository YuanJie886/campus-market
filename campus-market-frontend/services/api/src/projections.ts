const time = (value: any) => (value ? new Date(value).getTime() : undefined);
export function userView(r: any, privateFields = false) {
  return {
    id: r.id,
    nickname: r.nickname,
    avatar: r.avatar,
    campus: r.campus,
    createdAt: time(r.created_at),
    ...(privateFields ? { account: r.account, contact: r.contact } : {}),
  };
}
export function productView(r: any, owner = false) {
  return {
    id: r.id,
    sellerId: r.seller_id,
    title: r.title,
    description: r.description,
    price: Number(r.price),
    originalPrice:
      r.original_price == null ? undefined : Number(r.original_price),
    category: r.category,
    condition: r.condition,
    campus: r.campus,
    images: r.images,
    contact: owner ? r.contact : "",
    status: r.status,
    views: r.views,
    createdAt: time(r.created_at),
    soldAt: time(r.sold_at),
  };
}
export function reviewView(r: any) {
  return {
    rating: r.rating,
    comment: r.comment,
    createdAt: time(r.created_at),
  };
}
export const statusLabels: Record<string, string> = {
  PENDING_SELLER_CONFIRM: "待确认",
  PENDING_MEETING: "交易中",
  BUYER_CONFIRMED: "交易中",
  SELLER_CONFIRMED: "交易中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "已取消",
  DISPUTED: "交易中",
};
export function orderView(r: any, viewer: string, reviews: any[] = []) {
  return {
    id: r.id,
    productId: r.product_id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    price: Number(r.price),
    status: statusLabels[r.status],
    canonicalStatus: r.status,
    meetingPointId: r.meeting_point_id,
    meetingAtIso: new Date(r.meeting_at).toISOString(),
    contact: r.contact,
    confirmationCode: viewer === r.buyer_id ? r.confirmation_code : undefined,
    expiresAtIso: new Date(r.expires_at).toISOString(),
    createdAt: time(r.created_at),
    updatedAt: time(r.updated_at),
    buyerReview: reviews.find((v) => v.reviewer_id === r.buyer_id)
      ? reviewView(reviews.find((v) => v.reviewer_id === r.buyer_id))
      : undefined,
    sellerReview: reviews.find((v) => v.reviewer_id === r.seller_id)
      ? reviewView(reviews.find((v) => v.reviewer_id === r.seller_id))
      : undefined,
  };
}
export function favoriteView(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    productId: r.product_id,
    createdAt: time(r.created_at),
  };
}
export function commentView(r: any) {
  return {
    id: r.id,
    productId: r.product_id,
    userId: r.user_id,
    content: r.content,
    parentId: r.parent_id,
    createdAt: time(r.created_at),
  };
}
export function conversationView(r: any) {
  return {
    id: r.id,
    productId: r.product_id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    createdAt: time(r.created_at),
    updatedAt: time(r.updated_at),
  };
}
export function messageView(r: any) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    content: r.content,
    createdAt: time(r.created_at),
  };
}
