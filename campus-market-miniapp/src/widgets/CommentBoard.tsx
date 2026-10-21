import { Button, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Comment, User } from '../model';
import { timeAgo } from '../model';
import { COMMENT_MAX, COMMENT_PLACEHOLDER, NO_COMMENTS, canReportComment, commentError, commentText, threadComments } from '../comments';
import { notify } from '../state';
import { ReportSheet } from './ReportSheet';

/**
 * 商品留言板：留言、回复、举报；被平台隐藏的留言只显示占位（作者看到可申诉的提示）。
 * 内容安全拦截等服务端 400 原样显示在输入框下方，原文保留以便修改。
 */
export function CommentBoard({ productId, user, refreshKey }: { productId: string; user: User; refreshKey: number }) {
  const [comments, setComments] = useState<Comment[]>([]), [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useState(''), [replyTo, setReplyTo] = useState<Comment | null>(null), [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [reporting, setReporting] = useState<{ id: string; label: string } | null>(null);
  const sequence = useRef(0), known = useRef<Record<string, string>>({});

  const load = async () => {
    const gen = ++sequence.current;
    try {
      const list = await api.comments(productId);
      if (gen !== sequence.current) return;
      setComments(list); setLoadError('');
      // 作者昵称：同校公共资料，按 id 缓存；读取失败显示「同学」
      const missing = [...new Set(list.map((c) => c.userId))].filter((id) => id && !(id in known.current));
      if (missing.length) {
        const found = await Promise.all(missing.map((id) => api.publicUser(id).then((u) => [id, u.nickname] as const).catch(() => [id, ''] as const)));
        for (const [id, name] of found) known.current[id] = name;
        if (gen === sequence.current) setNames({ ...known.current });
      }
    } catch (e) { if (gen === sequence.current) setLoadError(e instanceof Error ? e.message : '留言加载失败'); }
  };
  useEffect(() => { known.current = {}; setComments([]); setReplyTo(null); setText(''); setError(''); setReporting(null); void load(); }, [productId, user.id]);
  useEffect(() => { if (refreshKey) void load(); }, [refreshKey]);

  const name = (id: string) => id === user.id ? `${user.nickname}（我）` : names[id] || '同学';
  const submit = async () => {
    if (busy) return;
    const problem = commentError(text);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { await api.addComment(productId, text.trim(), replyTo?.id ?? null); setText(''); setReplyTo(null); notify('留言成功'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : '留言失败，请重试'); }
    finally { setBusy(false); }
  };
  const threads = threadComments(comments);
  const reportLink = (c: Comment) => canReportComment(c, user.id)
    ? <Text className='comment-action' onClick={() => setReporting({ id: c.id, label: `${name(c.userId)}的${c.parentId ? '回复' : '留言'}` })}>举报</Text> : null;

  return <View className='detail-section'>
    <View className='section-head'><Text className='section-title'>留言板 · {comments.length} 条</Text></View>
    <Textarea className='field-input field-textarea comment-input' value={text} maxlength={COMMENT_MAX} placeholder={replyTo ? `回复 @${name(replyTo.userId)}` : COMMENT_PLACEHOLDER} onInput={(e) => setText(e.detail.value)} />
    {error ? <Text className='error-text'>{error}</Text> : null}
    <View className='button-row'>
      {replyTo && <Button className='secondary small' onClick={() => setReplyTo(null)}>取消回复</Button>}
      <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>{replyTo ? '回复' : '留言'}</Button>
    </View>
    {loadError ? <Text className='error-text'>{loadError}</Text> : null}
    {!threads.length && !loadError ? <Text className='muted comment-empty'>{NO_COMMENTS}</Text> : null}
    {threads.map(({ comment, replies }) => {
      const body = commentText(comment);
      return <View className='comment' key={comment.id}>
        <View className='comment-head'><Text className='comment-author'>{name(comment.userId)}</Text><Text className='comment-time'>{timeAgo(comment.createdAt)}</Text></View>
        <Text className={body.hidden ? 'comment-hidden' : 'comment-text'}>{body.text}</Text>
        <View className='comment-actions'>
          <Text className='comment-action brand' onClick={() => { setReplyTo(comment); setError(''); }}>回复</Text>
          {reportLink(comment)}
        </View>
        {replies.length > 0 && <View className='comment-replies'>
          {replies.map((reply) => {
            const r = commentText(reply, true);
            return <View className='comment-reply' key={reply.id}>
              <View className='comment-head'><Text className='comment-author'>{name(reply.userId)}</Text><Text className='comment-time'>{timeAgo(reply.createdAt)}</Text></View>
              <Text className={r.hidden ? 'comment-hidden' : 'comment-text'}>{r.text}</Text>
              <View className='comment-actions'>{reportLink(reply)}</View>
            </View>;
          })}
        </View>}
      </View>;
    })}
    {reporting && <ReportSheet targetType='COMMENT' targetId={reporting.id} targetLabel={reporting.label} onClose={() => setReporting(null)} />}
  </View>;
}
