import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import RatingStars from './RatingStars';

interface ReviewDialogProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void;
}

/** 交易评价弹窗：星级 + 文字 */
export default function ReviewDialog({
  open,
  title = '评价本次交易',
  onClose,
  onSubmit,
}: ReviewDialogProps) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) {
      setRating(5);
      setComment('');
    }
  }, [open]);

  const handleSubmit = () => {
    onSubmit(rating, comment.trim());
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          给对方的交易体验打个分吧
        </Typography>
        <div className="flex items-center gap-3 py-2">
          <RatingStars value={rating} readOnly={false} size="large" onChange={setRating} />
          <span className="text-sm font-semibold text-brand-600">{rating} 星</span>
        </div>
        <TextField
          label="评价内容"
          placeholder="说说这次交易的感受，帮助其他同学参考～"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          multiline
          minRows={3}
          fullWidth
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          取消
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          提交评价
        </Button>
      </DialogActions>
    </Dialog>
  );
}
