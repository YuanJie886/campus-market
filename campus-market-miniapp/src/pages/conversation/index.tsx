import Taro, { useRouter } from '@tarojs/taro';
import { Button, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate } from '../../components';
import type { ChatMessage, Conversation, MessageTemplate, SendMessageInput } from '../../model';
import { timeAgo } from '../../model';
import { canReportMessage, composerMode, conversationRole, counterpartOf, mergeMessages, messageText, templatesFor, THREAD_POLL_MS } from '../../messages';
import { messageUnread, useMarket, usePolling } from '../../state';
import { ReportSheet } from '../../widgets/ReportSheet';

/**
 * 私信会话：阶段 1 只能点选快捷消息（按我在会话里的买家 / 卖家身份过滤）；自由文字输入框只在服务端开通时显示。
 * 只在页面显示时每 5 秒读取一次新消息，读取后标记已读。发送失败（快捷消息不存在、不能由你发送、只能发送快捷消息、
 * 内容安全拦截等）原样显示服务端文案。
 */
export default function ConversationPage() {
  const { user } = useMarket(), router = useRouter();
  const id = router.params.id ?? '';
  const [conversation, setConversation] = useState<Conversation | null>(null), [messages, setMessages] = useState<ChatMessage[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]), [freeText, setFreeText] = useState(false);
  const [title, setTitle] = useState(''), [other, setOther] = useState(''), [error, setError] = useState(''), [sendError, setSendError] = useState('');
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [reporting, setReporting] = useState<ChatMessage | null>(null);
  const sequence = useRef(0), lastCount = useRef(0);

  /** 首次进入：找到会话（会话列表里取）、快捷消息、商品标题与对方昵称。 */
  const open = async () => {
    if (!user || !id) return;
    const gen = ++sequence.current;
    try {
      const [list, quick] = await Promise.all([api.conversations(), api.messageTemplates()]);
      if (gen !== sequence.current) return;
      const found = list.find((c) => c.id === id) ?? null;
      if (!found) { setError('会话不存在或这件商品已不可见'); setLoaded(true); return; }
      setConversation(found); setTemplates(quick.templates); setFreeText(quick.freeTextEnabled); setError('');
      const otherId = counterpartOf(found, user.id);
      const [product, person] = await Promise.all([api.detail(found.productId).catch(() => null), api.publicUser(otherId).catch(() => null)]);
      if (gen !== sequence.current) return;
      setTitle(product?.title ?? ''); setOther(person?.nickname ?? '');
      void Taro.setNavigationBarTitle({ title: person?.nickname || '私信' });
      await refresh();
    } catch (e) { if (gen === sequence.current) { setError(e instanceof Error ? e.message : '加载失败'); setLoaded(true); } }
  };
  /** 读取消息并标记已读（轮询也走这里）。 */
  const refresh = async () => {
    if (!user || !id) return;
    const gen = sequence.current;
    const list = await api.messages(id);
    if (gen !== sequence.current) return;
    setMessages((previous) => mergeMessages(previous, list)); setLoaded(true);
    await api.markConversationRead(id).catch(() => undefined);
    void messageUnread.refresh();
  };
  useEffect(() => { sequence.current++; setConversation(null); setMessages([]); setLoaded(false); setError(''); setSendError(''); setText(''); setReporting(null); void open(); }, [user?.id, id]);
  usePolling(refresh, THREAD_POLL_MS, Boolean(user && conversation));
  // 有新消息时滚到底部
  useEffect(() => { if (messages.length > lastCount.current) void Taro.pageScrollTo({ scrollTop: 100000, duration: 0 }).catch(() => undefined); lastCount.current = messages.length; }, [messages.length]);

  const send = async (input: SendMessageInput) => {
    if (busy || !conversation) return;
    setBusy(true); setSendError('');
    try {
      const message = await api.sendMessage(conversation.id, input);
      setMessages((previous) => mergeMessages(previous, [message]));
      if ('content' in input) setText('');
    } catch (e) { setSendError(e instanceof Error ? e.message : '发送失败，请重试'); }
    finally { setBusy(false); }
  };

  const role = conversation && user ? conversationRole(conversation, user.id) : null;
  const quick = templatesFor(templates, role), composer = composerMode(freeText);

  return <View className='page chat-page'>
    <LoginGate returnTo={`/pages/conversation/index?id=${encodeURIComponent(id)}`}>
      {error ? <ErrorState message={error} retry={() => { setError(''); void open(); }} /> : !conversation ? <Empty title='正在打开会话…' /> : <>
        <View className='chat-head' onClick={() => { if (title) void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(conversation.productId)}` }); }}>
          <Text className='req-name'>{other || (role === 'SELLER' ? '买家' : '卖家')}</Text>
          <Text className='req-sub'>{role === 'SELLER' ? '我是卖家' : '我是买家'} · 正在沟通：{title || '商品当前不可见'}{title ? ' ›' : ''}</Text>
        </View>
        {!messages.length ? <Text className='muted chat-empty'>{loaded ? '还没有消息，可以先点一条快捷消息打个招呼。' : '正在读取消息…'}</Text> : messages.map((m) => {
          const mine = m.senderId === user?.id;
          return <View className={`chat-row ${mine ? 'mine' : ''}`} key={m.id}>
            <View className={`chat-bubble ${mine ? 'mine' : ''} ${m.quarantined ? 'quarantined' : ''}`}><Text>{messageText(m, mine, templates)}</Text></View>
            <View className='chat-meta'>
              <Text>{timeAgo(m.createdAt)}</Text>
              {user && canReportMessage(m, user.id) ? <Text className='comment-action' onClick={() => setReporting(m)}>举报</Text> : null}
            </View>
          </View>;
        })}
        {reporting && <ReportSheet targetType='MESSAGE' targetId={reporting.id} targetLabel='对方发来的一条消息' onClose={() => setReporting(null)} />}
        <View className='chat-composer'>
          {composer.note ? <Text className='chat-note'>{composer.note}</Text> : null}
          {sendError ? <Text className='error-text'>{sendError}</Text> : null}
          <View className='quick-grid'>
            {quick.map((t) => <Text key={t.code} className={`quick-chip ${busy ? 'disabled' : ''}`} onClick={() => void send({ templateCode: t.code })}>{t.text}</Text>)}
          </View>
          {composer.freeText && <View className='chat-input-row'>
            <Textarea className='field-input chat-input' value={text} maxlength={500} autoHeight placeholder='输入消息' onInput={(e) => setText(e.detail.value)} />
            <Button className='primary small' disabled={busy} onClick={() => { if (!text.trim()) { setSendError('请输入消息内容'); return; } void send({ content: text.trim() }); }}>发送</Button>
          </View>}
        </View>
      </>}
    </LoginGate>
  </View>;
}
