import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import SentimentDissatisfiedIcon from '@mui/icons-material/SentimentDissatisfied';
import EmptyState from '../components/EmptyState';

/** 404 页面 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="py-6">
      <EmptyState
        icon={<SentimentDissatisfiedIcon sx={{ fontSize: 36 }} />}
        title="页面走丢了"
        description="你访问的页面不存在，也许链接已经失效啦～"
        action={
          <Button variant="contained" onClick={() => navigate('/')}>
            回到首页
          </Button>
        }
      />
    </div>
  );
}
