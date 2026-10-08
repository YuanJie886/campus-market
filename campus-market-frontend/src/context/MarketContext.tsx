import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  MarketState,
  Product,
  ProductInput,
  OrderStatus,
  Review,
  CanonicalOrderStatus,
} from "../types";
import type { MeetingPoint, CreateOrderInput } from "../api/contracts";
import { getApiClient } from "../api/client";
import { useAuth } from "./AuthContext";
import { useNotify } from "./NotificationContext";
import { toUserMessage } from '../api/errors';
const empty: MarketState = {
  products: [],
  orders: [],
  favorites: [],
  comments: [],
  conversations: [],
  messages: [],
};
function useMarketState() {
  const [state, setState] = useState<MarketState>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [meetingPoints, setMeetingPoints] = useState<MeetingPoint[]>([]);
  const [unread, setUnread] = useState(0);
  const { currentUser, loading: authLoading, loadUsers } = useAuth();
  const { error } = useNotify();
  const api = getApiClient();
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSequence.current,
      gen = generation.current;
    let products: Product[] = [];
    // 6.1A：未登录不读取任何商品（后端同样要求登录）；落地页只展示介绍与登录注册入口
    for (let page = 1; currentUser; page++) {
      const result = await api.listProducts({
        sort: "latest",
        page,
        pageSize: 100,
      });
      products.push(...result.items);
      if (products.length >= result.total || !result.items.length) break;
    }
    const [orders, favorites, conversations, points, count] = await Promise.all(
      [
        currentUser ? api.listOrders("all") : [],
        currentUser ? api.listFavorites() : [],
        currentUser ? api.listConversations() : [],
        api.listMeetingPoints(),
        currentUser ? api.getUnreadCount() : 0,
      ],
    );
    const extraIds = [
      ...new Set([
        ...orders.map((o) => o.productId),
        ...favorites.map((f) => f.productId),
        ...conversations.map((c) => c.productId),
      ]),
    ].filter((id) => !products.some((p) => p.id === id));
    const extras = await Promise.all(
      extraIds.map((id) => api.getProduct(id).catch(() => null)),
    );
    products.push(...extras.filter((p): p is Product => !!p));
    if (seq !== refreshSequence.current || gen !== generation.current) return;
    setState((prev) => ({
      ...prev,
      products,
      orders,
      favorites,
      conversations,
    }));
    setMeetingPoints(points);
    setUnread(count);
    setLoadError("");
    void loadUsers([
      ...products.map((p) => p.sellerId),
      ...orders.flatMap((o) => [o.buyerId, o.sellerId]),
      ...conversations.flatMap((c) => [c.buyerId, c.sellerId]),
    ]);
  }, [currentUser?.id, api, loadUsers]);
  useEffect(() => {
    generation.current++;
    setState(empty);
    setUnread(0);
    if (authLoading) return;
    let active = true;
    setLoading(true);
    refresh()
      .catch((e) => {
        if (active) setLoadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch((e) => {
          if (active) setLoadError(e.message);
        });
    }, 15000);
    return () => {
      active = false;
      generation.current++;
      refreshSequence.current++;
      clearInterval(timer);
    };
  }, [refresh, authLoading]);
  const productSaved = (product: Product) =>
    setState((prev) => ({
      ...prev,
      products: [product, ...prev.products.filter((p) => p.id !== product.id)],
    }));
  const afterMutation = () =>
    void refresh().catch((e) => setLoadError(e.message));
  const addProduct = async (input: ProductInput) => {
    const { sellerId, ...body } = input;
    const p = await api.createProduct(body);
    productSaved(p);
    return p;
  };
  const updateProduct = async (id: string, patch: import("../api/contracts").ProductPatch) => {
    const p = await api.updateProduct(id, patch);
    productSaved(p);
  };
  const setStatus = async (id: string, status: Product["status"]) => {
    productSaved(await api.setProductStatus(id, status));
  };
  /**
   * 幂等设置收藏状态。desired 由调用方根据当前 UI 状态显式声明，
   * 底层走 PUT / DELETE，不再由任何一层自行 toggle——那会让重试把收藏删掉。
   */
  const setFavorite = async (_uid: string, id: string, desired: boolean) => {
    const active = await api.setFavorite(id, desired);
    const favorites = await api.listFavorites();
    setState((p) => ({ ...p, favorites }));
    return active;
  };
  const createOrder = async (
    productId: string,
    _uid: string,
    meeting: Omit<CreateOrderInput, "productId">,
  ) => {
    const o = await api.createOrder({ ...meeting, productId });
    setState((p) => ({
      ...p,
      orders: [o, ...p.orders.filter((x) => x.id !== o.id)],
      products: p.products.map((x) =>
        x.id === productId ? { ...x, status: "预约中" } : x,
      ),
    }));
    return o;
  };
  const updateOrderStatus = async (
    id: string,
    status: OrderStatus | CanonicalOrderStatus,
    confirmationCode?: string,
    // 模块 7：取消时的结构化原因与说明
    cancellation?: { reasonCode?: import("../api/contracts").CancellationReason; note?: string },
  ) => {
    const to =
      (
        {
          交易中: "PENDING_MEETING",
          已取消: "CANCELLED",
          已完成: "COMPLETED",
          待确认: "PENDING_SELLER_CONFIRM",
        } as Record<string, CanonicalOrderStatus>
      )[status] ?? (status as CanonicalOrderStatus);
    const o = await api.transitionOrder(id, { to, ...(confirmationCode ? { confirmationCode } : {}), ...(to === "CANCELLED" ? cancellation ?? {} : {}) });
    setState((p) => ({
      ...p,
      orders: p.orders.map((x) => (x.id === id ? o : x)),
    }));
    afterMutation();
  };
  const addReview = async (id: string, uid: string, review: Review) => {
    // 只提交接口允许的两个字段：后端 REVIEW_FIELDS = rating / comment，其他字段一律 400（8.1 E2E 发现 createdAt 被一并提交）
    const saved = await api.addReview(id, { rating: review.rating, comment: review.comment });
    setState((p) => ({
      ...p,
      orders: p.orders.map((o) =>
        o.id === id
          ? {
              ...o,
              [o.buyerId === uid ? "buyerReview" : "sellerReview"]: saved,
            }
          : o,
      ),
    }));
  };
  const loadProduct = useCallback(
    async (id: string) => {
      const gen = generation.current;
      const [p, comments] = await Promise.all([
        api.getProduct(id),
        api.listComments(id),
      ]);
      if (gen !== generation.current) return p;
      productSaved(p);
      setState((prev) => ({
        ...prev,
        comments: [
          ...prev.comments.filter((c) => c.productId !== id),
          ...comments,
        ],
      }));
      void loadUsers([p.sellerId, ...comments.map((c) => c.userId)]);
      // 列表接口不含验货声明，调用方需要详情里的声明时直接用这里的返回值
      return p;
    },
    [api, loadUsers],
  );
  const incrementViews = useCallback(
    async (id: string) => {
      try {
        await api.incrementProductViews(id);
      } catch (e) {
        error(toUserMessage(e));
      }
    },
    [api],
  );
  const addComment = async (
    productId: string,
    _uid: string,
    content: string,
    parentId: string | null = null,
  ) => {
    const c = await api.addComment({ productId, content, parentId });
    setState((p) => ({ ...p, comments: [...p.comments, c] }));
  };
  const getOrCreateConversation = async (
    productId: string,
    _buyer: string,
    _seller: string,
  ) => {
    const c = await api.getOrCreateConversation(productId);
    setState((p) => ({
      ...p,
      conversations: [c, ...p.conversations.filter((x) => x.id !== c.id)],
    }));
    return c;
  };
  const loadMessages = useCallback(
    async (id: string) => {
      const gen = generation.current;
      const messages = await api.listMessages(id);
      if (gen !== generation.current) return;
      setState((p) => ({
        ...p,
        messages: [
          ...p.messages.filter((m) => m.conversationId !== id),
          ...messages,
        ],
      }));
      await api.markConversationRead(id);
      const count = await api.getUnreadCount();
      if (gen === generation.current) setUnread(count);
    },
    [api],
  );
  const sendMessage = async (id: string, _uid: string, content: string) => {
    const m = await api.sendMessage(id, content);
    setState((p) => ({
      ...p,
      messages: [...p.messages.filter((x) => x.id !== m.id), m],
      conversations: p.conversations.map((c) =>
        c.id === id ? { ...c, updatedAt: m.createdAt } : c,
      ),
    }));
  };
  return {
    ...state,
    loading,
    loadError,
    refresh,
    meetingPoints,
    loadProduct,
    loadMessages,
    getProduct: (id: string) => state.products.find((p) => p.id === id),
    addProduct,
    updateProduct,
    markSold: (id: string) => setStatus(id, "已售出"),
    takedownProduct: (id: string) => setStatus(id, "已下架"),
    relistProduct: (id: string) => setStatus(id, "在售"),
    removeProduct: (id: string) => setStatus(id, "已下架"),
    incrementViews,
    getSellerProducts: (id: string) =>
      state.products.filter((p) => p.sellerId === id),
    isFavorite: (uid: string | null | undefined, id: string) =>
      state.favorites.some((f) => f.userId === uid && f.productId === id),
    setFavorite,
    getFavoriteProducts: (uid: string) =>
      state.favorites
        .filter((f) => f.userId === uid)
        .map((f) => state.products.find((p) => p.id === f.productId))
        .filter((p): p is Product => !!p),
    createOrder,
    updateOrderStatus,
    addReview,
    getBuyOrders: (id: string) => state.orders.filter((o) => o.buyerId === id),
    getSellOrders: (id: string) =>
      state.orders.filter((o) => o.sellerId === id),
    getProductComments: (id: string) =>
      state.comments.filter((c) => c.productId === id),
    addComment,
    getOrCreateConversation,
    getConversationsForUser: (id: string) =>
      state.conversations.filter((c) => c.buyerId === id || c.sellerId === id),
    getMessages: (id: string) =>
      state.messages.filter((m) => m.conversationId === id),
    sendMessage,
    getUnreadCount: (_uid: string) => unread,
    resetDemoData: () => error("真实数据由服务端保存，不支持一键重置"),
  };
}
const MarketContext = createContext<ReturnType<typeof useMarketState> | null>(
  null,
);
export function MarketProvider({ children }: { children: ReactNode }) {
  return (
    <MarketContext.Provider value={useMarketState()}>
      {children}
    </MarketContext.Provider>
  );
}
export function useMarket() {
  const c = useContext(MarketContext);
  if (!c) throw new Error("缺少 MarketProvider");
  return c;
}
