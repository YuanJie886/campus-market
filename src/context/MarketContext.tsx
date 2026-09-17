import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import type { ReactNode } from 'react';
import type {
  ChatMessage,
  Comment,
  Conversation,
  Favorite,
  MarketState,
  Order,
  OrderStatus,
  Product,
  ProductInput,
  Review,
} from '../types';
import { loadState, saveState, STORAGE_KEYS } from '../utils/storage';
import { uid } from '../utils/id';
import { buildSeedMarketState } from '../data/seed';

/** 市场数据上下文：商品 / 订单 / 留言 / 收藏 / 会话 / 消息 */

type Action =
  | { type: 'RESET'; payload: MarketState }
  | { type: 'ADD_PRODUCT'; payload: Product }
  | { type: 'UPDATE_PRODUCT'; payload: { id: string; patch: Partial<Product> } }
  | { type: 'INCREMENT_VIEWS'; payload: { id: string } }
  | { type: 'ADD_FAVORITE'; payload: Favorite }
  | { type: 'REMOVE_FAVORITE'; payload: { userId: string; productId: string } }
  | { type: 'ADD_ORDER'; payload: Order }
  | { type: 'UPDATE_ORDER'; payload: { id: string; patch: Partial<Order> } }
  | { type: 'ADD_COMMENT'; payload: Comment }
  | { type: 'ADD_CONVERSATION'; payload: Conversation }
  | { type: 'TOUCH_CONVERSATION'; payload: { id: string; updatedAt: number } }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage };

function reducer(state: MarketState, action: Action): MarketState {
  switch (action.type) {
    case 'RESET':
      return action.payload;

    case 'ADD_PRODUCT':
      return { ...state, products: [action.payload, ...state.products] };

    case 'UPDATE_PRODUCT':
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.payload.id ? { ...p, ...action.payload.patch } : p,
        ),
      };

    case 'INCREMENT_VIEWS':
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.payload.id ? { ...p, views: p.views + 1 } : p,
        ),
      };

    case 'ADD_FAVORITE':
      return { ...state, favorites: [action.payload, ...state.favorites] };

    case 'REMOVE_FAVORITE':
      return {
        ...state,
        favorites: state.favorites.filter(
          (f) =>
            !(
              f.userId === action.payload.userId &&
              f.productId === action.payload.productId
            ),
        ),
      };

    case 'ADD_ORDER':
      return { ...state, orders: [action.payload, ...state.orders] };

    case 'UPDATE_ORDER':
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === action.payload.id ? { ...o, ...action.payload.patch } : o,
        ),
      };

    case 'ADD_COMMENT':
      return { ...state, comments: [action.payload, ...state.comments] };

    case 'ADD_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
      };

    case 'TOUCH_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.id
            ? { ...c, updatedAt: action.payload.updatedAt }
            : c,
        ),
      };

    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };

    default:
      return state;
  }
}

interface MarketContextValue {
  /* 原始数据 */
  products: Product[];
  orders: Order[];
  comments: Comment[];
  favorites: Favorite[];
  conversations: Conversation[];
  messages: ChatMessage[];

  /* 商品 */
  getProduct: (id: string) => Product | undefined;
  addProduct: (input: ProductInput) => Product;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  markSold: (id: string) => void;
  takedownProduct: (id: string) => void;
  relistProduct: (id: string) => void;
  removeProduct: (id: string) => void;
  incrementViews: (id: string) => void;
  getSellerProducts: (sellerId: string) => Product[];

  /* 收藏 */
  isFavorite: (userId: string | null | undefined, productId: string) => boolean;
  toggleFavorite: (userId: string, productId: string) => boolean;
  getFavoriteProducts: (userId: string) => Product[];

  /* 订单 */
  createOrder: (productId: string, buyerId: string) => Order | null;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  addReview: (orderId: string, reviewerId: string, review: Review) => void;
  getBuyOrders: (userId: string) => Order[];
  getSellOrders: (userId: string) => Order[];

  /* 留言板 */
  getProductComments: (productId: string) => Comment[];
  addComment: (
    productId: string,
    userId: string,
    content: string,
    parentId?: string | null,
  ) => void;

  /* 会话与消息 */
  getOrCreateConversation: (
    productId: string,
    buyerId: string,
    sellerId: string,
  ) => Conversation;
  getConversationsForUser: (userId: string) => Conversation[];
  getMessages: (conversationId: string) => ChatMessage[];
  sendMessage: (
    conversationId: string,
    senderId: string,
    content: string,
  ) => void;
  getUnreadCount: (userId: string) => number;

  /* 演示数据 */
  resetDemoData: () => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  // 首次渲染时从 localStorage 读取，缺失则写入种子数据（仅计算一次）
  const initialState = useMemo<MarketState>(
    () => loadState<MarketState>(STORAGE_KEYS.market, buildSeedMarketState()),
    [],
  );

  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    saveState(STORAGE_KEYS.market, state);
  }, [state]);

  /* ------------------------------ 商品 ------------------------------ */

  const getProduct = useCallback(
    (id: string): Product | undefined => state.products.find((p) => p.id === id),
    [state.products],
  );

  const addProduct = useCallback((input: ProductInput): Product => {
    const product: Product = {
      id: uid('p'),
      title: input.title.trim(),
      description: input.description.trim(),
      price: input.price,
      originalPrice: input.originalPrice,
      category: input.category,
      condition: input.condition,
      campus: input.campus,
      images:
        input.images.length > 0
          ? input.images
          : [`https://picsum.photos/seed/${uid('pimg')}/600/600`],
      contact: input.contact.trim(),
      sellerId: input.sellerId,
      status: '在售',
      views: 0,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_PRODUCT', payload: product });
    return product;
  }, []);

  const updateProduct = useCallback((id: string, patch: Partial<Product>) => {
    dispatch({ type: 'UPDATE_PRODUCT', payload: { id, patch } });
  }, []);

  const markSold = useCallback((id: string) => {
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: { id, patch: { status: '已售出', soldAt: Date.now() } },
    });
  }, []);

  const takedownProduct = useCallback((id: string) => {
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: { id, patch: { status: '已下架' } },
    });
  }, []);

  const relistProduct = useCallback((id: string) => {
    dispatch({
      type: 'UPDATE_PRODUCT',
      payload: { id, patch: { status: '在售', soldAt: undefined } },
    });
  }, []);

  const removeProduct = useCallback((id: string) => {
    dispatch({ type: 'UPDATE_PRODUCT', payload: { id, patch: { status: '已下架' } } });
  }, []);

  const incrementViews = useCallback((id: string) => {
    dispatch({ type: 'INCREMENT_VIEWS', payload: { id } });
  }, []);

  const getSellerProducts = useCallback(
    (sellerId: string): Product[] =>
      state.products
        .filter((p) => p.sellerId === sellerId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.products],
  );

  /* ------------------------------ 收藏 ------------------------------ */

  const isFavorite = useCallback(
    (userId: string | null | undefined, productId: string): boolean => {
      if (!userId) return false;
      return state.favorites.some(
        (f) => f.userId === userId && f.productId === productId,
      );
    },
    [state.favorites],
  );

  const toggleFavorite = useCallback(
    (userId: string, productId: string): boolean => {
      const exists = state.favorites.some(
        (f) => f.userId === userId && f.productId === productId,
      );
      if (exists) {
        dispatch({ type: 'REMOVE_FAVORITE', payload: { userId, productId } });
        return false;
      }
      dispatch({
        type: 'ADD_FAVORITE',
        payload: { id: uid('f'), userId, productId, createdAt: Date.now() },
      });
      return true;
    },
    [state.favorites],
  );

  const getFavoriteProducts = useCallback(
    (userId: string): Product[] => {
      const favs = state.favorites
        .filter((f) => f.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt);
      return favs
        .map((f) => state.products.find((p) => p.id === f.productId))
        .filter((p): p is Product => Boolean(p));
    },
    [state.favorites, state.products],
  );

  /* ------------------------------ 订单 ------------------------------ */

  const createOrder = useCallback(
    (productId: string, buyerId: string): Order | null => {
      const product = state.products.find((p) => p.id === productId);
      if (!product) return null;
      if (product.status !== '在售') return null;
      if (product.sellerId === buyerId) return null;

      const now = Date.now();
      const order: Order = {
        id: uid('o'),
        productId,
        buyerId,
        sellerId: product.sellerId,
        price: product.price,
        status: '待确认',
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'ADD_ORDER', payload: order });
      // 下单后锁定商品，避免超卖
      dispatch({
        type: 'UPDATE_PRODUCT',
        payload: { id: productId, patch: { status: '已售出' } },
      });
      return order;
    },
    [state.products],
  );

  const updateOrderStatus = useCallback(
    (orderId: string, status: OrderStatus) => {
      const order = state.orders.find((o) => o.id === orderId);
      if (!order) return;
      dispatch({
        type: 'UPDATE_ORDER',
        payload: { id: orderId, patch: { status, updatedAt: Date.now() } },
      });
      if (status === '已完成') {
        dispatch({
          type: 'UPDATE_PRODUCT',
          payload: {
            id: order.productId,
            patch: { status: '已售出', soldAt: Date.now() },
          },
        });
      }
      if (status === '已取消') {
        // 取消后商品重新上架（若仍为已售出）
        const product = state.products.find((p) => p.id === order.productId);
        if (product && product.status === '已售出') {
          dispatch({
            type: 'UPDATE_PRODUCT',
            payload: { id: order.productId, patch: { status: '在售', soldAt: undefined } },
          });
        }
      }
    },
    [state.orders, state.products],
  );

  const addReview = useCallback(
    (orderId: string, reviewerId: string, review: Review) => {
      const order = state.orders.find((o) => o.id === orderId);
      if (!order) return;
      if (reviewerId === order.buyerId) {
        dispatch({
          type: 'UPDATE_ORDER',
          payload: {
            id: orderId,
            patch: { buyerReview: review, updatedAt: Date.now() },
          },
        });
      } else if (reviewerId === order.sellerId) {
        dispatch({
          type: 'UPDATE_ORDER',
          payload: {
            id: orderId,
            patch: { sellerReview: review, updatedAt: Date.now() },
          },
        });
      }
    },
    [state.orders],
  );

  const getBuyOrders = useCallback(
    (userId: string): Order[] =>
      state.orders
        .filter((o) => o.buyerId === userId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.orders],
  );

  const getSellOrders = useCallback(
    (userId: string): Order[] =>
      state.orders
        .filter((o) => o.sellerId === userId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.orders],
  );

  /* ----------------------------- 留言板 ----------------------------- */

  const getProductComments = useCallback(
    (productId: string): Comment[] =>
      state.comments
        .filter((c) => c.productId === productId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.comments],
  );

  const addComment = useCallback(
    (
      productId: string,
      userId: string,
      content: string,
      parentId: string | null = null,
    ) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const comment: Comment = {
        id: uid('c'),
        productId,
        userId,
        content: trimmed,
        createdAt: Date.now(),
        parentId,
      };
      dispatch({ type: 'ADD_COMMENT', payload: comment });
    },
    [],
  );

  /* --------------------------- 会话与消息 --------------------------- */

  const getOrCreateConversation = useCallback(
    (productId: string, buyerId: string, sellerId: string): Conversation => {
      const existing = state.conversations.find(
        (c) =>
          c.productId === productId &&
          c.buyerId === buyerId &&
          c.sellerId === sellerId,
      );
      if (existing) return existing;
      const now = Date.now();
      const conversation: Conversation = {
        id: uid('conv'),
        productId,
        buyerId,
        sellerId,
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'ADD_CONVERSATION', payload: conversation });
      return conversation;
    },
    [state.conversations],
  );

  const getConversationsForUser = useCallback(
    (userId: string): Conversation[] =>
      state.conversations
        .filter((c) => c.buyerId === userId || c.sellerId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.conversations],
  );

  const getMessages = useCallback(
    (conversationId: string): ChatMessage[] =>
      state.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [state.messages],
  );

  const sendMessage = useCallback(
    (conversationId: string, senderId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const now = Date.now();
      const message: ChatMessage = {
        id: uid('m'),
        conversationId,
        senderId,
        content: trimmed,
        createdAt: now,
      };
      dispatch({ type: 'ADD_MESSAGE', payload: message });
      dispatch({
        type: 'TOUCH_CONVERSATION',
        payload: { id: conversationId, updatedAt: now },
      });
    },
    [],
  );

  /** 未读数：他人发给我的最后一条消息若晚于「我最后一次发送」则计为 1（演示口径） */
  const getUnreadCount = useCallback(
    (userId: string): number => {
      const convs = state.conversations.filter(
        (c) => c.buyerId === userId || c.sellerId === userId,
      );
      let count = 0;
      convs.forEach((c) => {
        const msgs = state.messages
          .filter((m) => m.conversationId === c.id)
          .sort((a, b) => a.createdAt - b.createdAt);
        const last = msgs[msgs.length - 1];
        if (last && last.senderId !== userId) count += 1;
      });
      return count;
    },
    [state.conversations, state.messages],
  );

  /* --------------------------- 演示数据 --------------------------- */

  const resetDemoData = useCallback(() => {
    dispatch({ type: 'RESET', payload: buildSeedMarketState() });
  }, []);

  const value = useMemo<MarketContextValue>(
    () => ({
      products: state.products,
      orders: state.orders,
      comments: state.comments,
      favorites: state.favorites,
      conversations: state.conversations,
      messages: state.messages,
      getProduct,
      addProduct,
      updateProduct,
      markSold,
      takedownProduct,
      relistProduct,
      removeProduct,
      incrementViews,
      getSellerProducts,
      isFavorite,
      toggleFavorite,
      getFavoriteProducts,
      createOrder,
      updateOrderStatus,
      addReview,
      getBuyOrders,
      getSellOrders,
      getProductComments,
      addComment,
      getOrCreateConversation,
      getConversationsForUser,
      getMessages,
      sendMessage,
      getUnreadCount,
      resetDemoData,
    }),
    [
      state,
      getProduct,
      addProduct,
      updateProduct,
      markSold,
      takedownProduct,
      relistProduct,
      removeProduct,
      incrementViews,
      getSellerProducts,
      isFavorite,
      toggleFavorite,
      getFavoriteProducts,
      createOrder,
      updateOrderStatus,
      addReview,
      getBuyOrders,
      getSellOrders,
      getProductComments,
      addComment,
      getOrCreateConversation,
      getConversationsForUser,
      getMessages,
      sendMessage,
      getUnreadCount,
      resetDemoData,
    ],
  );

  return (
    <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
  );
}

/** 使用市场数据上下文 */
export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) {
    throw new Error('useMarket 必须在 MarketProvider 内使用');
  }
  return ctx;
}
