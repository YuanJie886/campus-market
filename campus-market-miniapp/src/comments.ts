/**
 * 商品留言板的展示规则（纯函数，不依赖 Taro，便于测试），与 Web 商品详情页一致：
 * 顶层留言按服务端顺序（最新在前），回复挂在所属留言下按时间先后；被平台隐藏的留言只显示占位，作者看到可申诉的提示。
 */
import type { Comment } from './model';

export const COMMENT_MAX = 500;
export const COMMENT_PLACEHOLDER = '想问点什么？例如：还在吗？能小刀吗？';
export const NO_COMMENTS = '还没有留言，来问第一个问题吧～';

export interface CommentThread { comment: Comment; replies: Comment[] }

export function threadComments(comments: Comment[]): CommentThread[] {
  const replies = new Map<string, Comment[]>();
  for (const c of comments) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  return comments.filter((c) => c.parentId === null)
    .map((comment) => ({ comment, replies: (replies.get(comment.id) ?? []).sort((a, b) => a.createdAt - b.createdAt) }));
}

/** 正文或隐藏占位；reply 区分留言与回复的作者提示。 */
export function commentText(comment: Pick<Comment, 'content' | 'moderationHidden' | 'hiddenForAuthor'>, reply = false): { text: string; hidden: boolean } {
  if (!comment.moderationHidden) return { text: comment.content, hidden: false };
  if (reply) return { text: comment.hiddenForAuthor ? '你的这条回复已被平台隐藏；原文保留，可以在「我的限制」里申诉。' : '该回复已被平台隐藏。', hidden: true };
  return { text: comment.hiddenForAuthor ? '你的这条留言已被平台隐藏，其他同学看不到内容；原文保留，没有删除。可以在「我的限制」里查看并申诉一次。' : '该留言已被平台隐藏。', hidden: true };
}

/** 可以举报：别人的、没有被隐藏的留言或回复。 */
export const canReportComment = (comment: Pick<Comment, 'userId' | 'moderationHidden'>, userId: string | undefined) => comment.userId !== userId && !comment.moderationHidden;

export function commentError(content: string): string | null {
  if (!content.trim()) return '请输入留言内容';
  if (content.trim().length > COMMENT_MAX) return `留言最多 ${COMMENT_MAX} 字`;
  return null;
}
