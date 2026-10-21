import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "../components/Avatar";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import EmptyState from "../components/EmptyState";
import ImageWithFallback from "../components/ImageWithFallback";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { useNotify } from "../context/NotificationContext";
import { CATEGORY_EMOJI, CATEGORY_GRADIENT } from "../utils/constants";
import { formatChatTime } from "../utils/format";
import { toUserMessage } from '../api/errors';
import ReportDialog from '../components/governance/ReportDialog';
import { getApiClient } from '../api/client';
import { templatesForRole, type MessageTemplateList, type SendMessageInput } from '../api/contracts';
import { useClientConfig } from '../hooks/useClientConfig';

/** 文字私信关闭时（默认）显示在快捷消息上方的说明 */
export const QUICK_MESSAGE_NOTICE = '为保护双方安全，私信目前只能发送快捷消息；交换联系方式请使用「申请联系方式」';

/** 站内消息页：会话列表 + 聊天窗口 */
export default function MessagesPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const { currentUser, getUser } = useAuth();
  const { getConversationsForUser, getMessages, sendMessage, getProduct } =
    useMarket();
  const { error } = useNotify();

  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  // 快捷消息由服务端给出（GET /v1/message-templates）；文字输入框只在服务端明确开放时出现
  const { config, loading: configLoading } = useClientConfig();
  const [templateList, setTemplateList] = useState<MessageTemplateList | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  const currentUserId = currentUser?.id ?? null;
  useEffect(() => {
    if (!currentUserId) return;
    let alive = true;
    setTemplatesError(null);
    getApiClient().listMessageTemplates()
      .then((list) => { if (alive) setTemplateList(list) })
      .catch((e) => { if (alive) setTemplatesError(toUserMessage(e)) });
    return () => { alive = false };
  }, [currentUserId, templatesAttempt]);
  // 发送失败时服务端的原话（例如内容安全拦截）显示在输入框上方，消息原文保留以便修改
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => { setSendError(null) }, [conversationId]);
  // 模块 7：举报对方发来的某一条消息（只快照这一条，不复制整段会话）
  const [reportingMessage, setReportingMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const conversations = currentUser
    ? getConversationsForUser(currentUser.id)
    : [];
  const { loadMessages, loading: marketLoading } = useMarket();
  useEffect(() => {
    // 等市场数据首次刷新结束再读消息：刷新开始时会作废之前发出的读取（generation），
    // 否则首屏会显示「暂无消息」，直到下一次 5 秒轮询才出现消息
    if (!conversationId || marketLoading) return;
    let active = true;
    const load = () =>
      loadMessages(conversationId).catch((e) => {
        if (active) error(e.message);
      });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [conversationId, loadMessages, marketLoading]);
  const active = conversations.find((c) => c.id === conversationId) ?? null;
  const messages = active ? getMessages(active.id) : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, active?.id]);

  useEffect(() => {
    setText("");
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

  // 以快捷消息接口的结果为准；还没拿到时参考 /v1/config。两处都只认明确的 true
  const freeTextEnabled = templateList
    ? templateList.freeTextEnabled
    : !configLoading && config.messages.freeTextEnabled;
  const myRole = active && active.buyerId === currentUser.id ? "BUYER" : "SELLER";
  const quickMessages = templateList ? templatesForRole(templateList.templates, myRole) : [];

  const submit = async (input: SendMessageInput) => {
    if (busy || !active) return false;
    setBusy(true);
    try {
      setSendError(null);
      await sendMessage(active.id, input);
      return true;
    } catch (e) {
      // 服务端的原话（模板不能由你发送、只能发快捷消息、内容安全拦截……）原样显示
      const message = toUserMessage(e);
      setSendError(message);
      error(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (busy) return;
    const content = text.trim();
    if (!content) {
      error("请输入消息内容");
      return;
    }
    if (await submit({ content })) setText("");
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-extrabold text-slate-800 md:text-2xl">
        站内消息
      </h1>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<ChatBubbleOutlineIcon sx={{ fontSize: 34 }} />}
          title="还没有会话"
          description="在商品详情页点「私信卖家」，可以用快捷消息询问。"
          action={
            <Button variant="contained" onClick={() => navigate("/")}>
              去逛逛
            </Button>
          }
        />
      ) : (
        <div className="flex h-[calc(100vh-230px)] min-h-[420px] gap-3 md:h-[calc(100vh-200px)]">
          {/* 会话列表 */}
          <aside
            className={`${
              active ? "hidden md:flex" : "flex"
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
                      selected ? "bg-brand-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <ImageWithFallback
                      src={product?.images[0]}
                      alt={product?.title ?? "商品"}
                      emoji={product ? CATEGORY_EMOJI[product.category] : "📦"}
                      gradient={
                        product
                          ? CATEGORY_GRADIENT[product.category]
                          : "linear-gradient(135deg,#e2e8f0,#cbd5e1)"
                      }
                      className="h-11 w-11 shrink-0 rounded-xl"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {other?.nickname ?? "用户"}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatChatTime(conversation.updatedAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-400">
                        {product?.title ?? "商品已删除"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {last ? (last.quarantined ? "该消息已被平台隔离" : last.content) : "暂无消息"}
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
              active ? "flex" : "hidden md:flex"
            } min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card`}
          >
            {active ? (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                  <IconButton
                    className="md:hidden"
                    size="small"
                    onClick={() => navigate("/messages")}
                    aria-label="返回会话列表"
                  >
                    <ArrowBackIcon fontSize="small" />
                  </IconButton>
                  <Avatar
                    avatar={counterpart?.avatar}
                    nickname={counterpart?.nickname}
                    userId={counterpart?.id}
                    alt={`${counterpart?.nickname ?? "对方"}的头像`}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {counterpart?.nickname ?? "用户"}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      正在沟通：
                      {getProduct(active.productId)?.title ?? "商品已删除"}
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
                  role="log"
                  aria-label="聊天记录"
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
                          mine ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        <Avatar
                          avatar={sender?.avatar}
                          nickname={sender?.nickname}
                          userId={sender?.id ?? message.senderId}
                          alt={`${sender?.nickname ?? "同学"}的头像`}
                          size={30}
                        />
                        <div
                          className={`max-w-[76%] ${mine ? "items-end" : "items-start"} flex flex-col`}
                        >
                          <div
                            className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${
                              mine
                                ? "rounded-br-sm bg-brand-600 text-white"
                                : "rounded-bl-sm bg-white text-slate-700"
                            }`}
                          >
                            {message.quarantined ? (
                              <span role="note" className="italic">
                                {mine ? "你发送的这条消息已被平台隔离，对方看不到内容；可以在「我的限制」里申诉。" : "该消息已被平台隔离。"}
                              </span>
                            ) : message.content}
                          </div>
                          <span className="mt-0.5 text-[10px] text-slate-400">
                            {formatChatTime(message.createdAt)}
                          </span>
                          {!mine && !message.quarantined && (
                            <button type="button" className="text-[11px] text-slate-600 underline" onClick={() => setReportingMessage(message.id)}
                              aria-label={`举报 ${formatChatTime(message.createdAt)} 的这条消息`}>
                              举报
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {sendError && <p role="alert" className="border-t border-slate-100 px-3 pt-2 text-sm text-red-700">{sendError}</p>}
                <section aria-labelledby="quick-messages-title" className="border-t border-slate-100 px-3 pt-2.5">
                  <h2 id="quick-messages-title" className="text-xs font-semibold text-slate-600">
                    快捷消息（点一下即发送）
                  </h2>
                  {!freeTextEnabled && (
                    <p id="quick-messages-notice" className="mt-1 text-xs leading-5 text-slate-500">
                      {QUICK_MESSAGE_NOTICE}
                    </p>
                  )}
                  {templatesError ? (
                    <p className="mt-1.5 text-xs text-red-700">
                      快捷消息加载失败：{templatesError}
                      <button type="button" className="ml-1 font-semibold underline" onClick={() => setTemplatesAttempt((n) => n + 1)}>
                        重试
                      </button>
                    </p>
                  ) : !templateList ? (
                    <p className="mt-1.5 text-xs text-slate-500" role="status">正在加载快捷消息…</p>
                  ) : (
                    <ul className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pb-1" aria-label="可发送的快捷消息">
                      {quickMessages.map((template) => (
                        <li key={template.code}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void submit({ templateCode: template.code })}
                            className="rounded-full border border-brand-200 bg-white px-3 py-1 text-left text-xs text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
                          >
                            {template.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {freeTextEnabled && (
                <div className="flex items-end gap-2 px-3 py-2.5">
                  <TextField
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入消息，回车发送…"
                    inputProps={{ "aria-label": "输入消息" }}
                    fullWidth
                    multiline
                    maxRows={3}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={handleSend}
                    disabled={busy}
                    endIcon={<SendIcon />}
                    sx={{ height: 40, flexShrink: 0 }}
                  >
                    发送
                  </Button>
                </div>
                )}
                {!freeTextEnabled && <div className="pb-2" />}
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
      {reportingMessage && (
        <ReportDialog open targetType="MESSAGE" targetId={reportingMessage} targetLabel="对方发来的一条消息" onClose={() => setReportingMessage(null)} />
      )}
    </div>
  );
}
