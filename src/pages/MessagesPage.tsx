import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SendIcon from '@mui/icons-material/Send';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import EmptyState from '../components/EmptyState';
import ImageWithFallback from '../components/ImageWithFallback';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';
import { CATEGORY_EMOJI, CATEGORY_GRADIENT } from '../utils/constants';
import { formatChatTime } from '../utils/format';

/** 站内消息页：会话列表 + 聊天窗口 */
export default function MessagesPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { currentUser, getUser } = useAuth();
  const {
    getConversationsForUser,
    getMessages,
    sendMessage,
    getProduct,
  } = useMarket();
  const { error } = useNotify();

  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const conversations = currentUser ? getConversationsForUser(currentUser.id) : [];
  const active = conversations.find((c) => c.id === conversationId) ?? null;
  const messages = active ? getMessages(active.id) : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, active?.id]);

  useEffect(() => {
    setText('');
  }, [conversationId]);

  if (!currentUser) {
    return null;
  }

  const counterpartId = active
    ? active.buyerId === currentUser.id
      ? active.sellerId
      : active.buyerId
    : null;
  const counterpart = getUser(counterpartId);

  const handleSend = () => {
    if (!active) return;
    const content = text.trim();
    if (!content) {
      error('请输入消息内容');
      return;
    }
    sendMessage(active.id, currentUser.id, content);
    setText('');
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-extrabold text-slate-800 md:text-2xl">站内消息</h1>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleOutlineIcon sx={{ fontSize: 34 }} />}
          title="还没有会话"
          description="在商品详情页点击「联系卖家」，就可以和同学聊起来啦～"
          action={
            <Button variant="contained" onClick={() => navigate('/')}>
              去逛逛
            </Button>
          }
        />
      ) : (
        <div className="flex h-[calc(100vh-230px)] min-h-[420px] gap-3 md:h-[calc(100vh-200px)]">
          {/* 会话列表 */}
          <aside
            className={`${
              active ? 'hidden md:flex' : 'flex'
            } w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card md:w-[320px] md:shrink-0`}
          >
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
              全部会话（{conversations.length}）
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map((conversation) => {
                const product = getProduct(conversation.productId);
                const otherId =
                  conversation.buyerId === currentUser.id
                    ? conversation.sellerId
                    : conversation.buyerId;
                const other = getUser(otherId);
                const last = getMessages(conversation.id).slice(-1)[0];
                const selected = conversation.id === conversationId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => navigate(`/messages/${conversation.id}`)}
                    className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-3 text-left transition ${
                      selected ? 'bg-brand-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <ImageWithFallback
                      src={product?.images[0]}
                      alt={product?.title ?? '商品'}
                      emoji={product ? CATEGORY_EMOJI[product.category] : '📦'}
                      gradient={
                        product
                          ? CATEGORY_GRADIENT[product.category]
                          : 'linear-gradient(135deg,#e2e8f0,#cbd5e1)'
                      }
                      className="h-11 w-11 shrink-0 rounded-xl"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {other?.nickname ?? '用户'}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatChatTime(conversation.updatedAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-400">
                        {product?.title ?? '商品已删除'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {last ? last.content : '暂无消息'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* 聊天窗口 */}
          <section
            className={`${
              active ? 'flex' : 'hidden md:flex'
            } min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card`}
          >
            {active ? (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                  <IconButton
                    className="md:hidden"
                    size="small"
                    onClick={() => navigate('/messages')}
                    aria-label="返回会话列表"
                  >
                    <ArrowBackIcon fontSize="small" />
                  </IconButton>
                  <Avatar src={counterpart?.avatar} sx={{ width: 32, height: 32 }}>
                    {counterpart?.nickname?.slice(0, 1)}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {counterpart?.nickname ?? '用户'}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      正在沟通：{getProduct(active.productId)?.title ?? '商品已删除'}
                    </p>
                  </div>
                  {getProduct(active.productId) && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(`/product/${active.productId}`)}
                    >
                      查看商品
                    </Button>
                  )}
                </div>

                <div
                  ref={scrollRef}
                  className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-3 py-4"
                >
                  {messages.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-400">
                      打个招呼开始聊天吧～
                    </p>
                  )}
                  {messages.map((message) => {
                    const mine = message.senderId === currentUser.id;
                    const sender = getUser(message.senderId);
                    return (
                      <div
                        key={message.id}
                        className={`flex items-end gap-2 ${
                          mine ? 'flex-row-reverse' : 'flex-row'
                        }`}
                      >
                        <Avatar src={sender?.avatar} sx={{ width: 30, height: 30 }}>
                          {sender?.nickname?.slice(0, 1)}
                        </Avatar>
                        <div className={`max-w-[76%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                          <div
                            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${
                              mine
                                ? 'rounded-br-sm bg-brand-600 text-white'
                                : 'rounded-bl-sm bg-white text-slate-700'
                            }`}
                          >
                            {message.content}
                          </div>
                          <span className="mt-0.5 text-[10px] text-slate-400">
                            {formatChatTime(message.createdAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-end gap-2 border-t border-slate-100 px-3 py-2.5">
                  <TextField
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入消息，回车发送…"
                    fullWidth
                    multiline
                    maxRows={3}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={handleSend}
                    endIcon={<SendIcon />}
                    sx={{ height: 40, flexShrink: 0 }}
                  >
                    发送
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
                选择左侧的一个会话开始聊天
                {active === null && conversations[0] && (
                  <button
                    type="button"
                    className="ml-1 font-semibold text-brand-600"
                    onClick={() => navigate(`/messages/${conversations[0].id}`)}
                  >
                    打开最新会话
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
