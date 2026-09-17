import { useNavigate } from 'react-router-dom';
import ProductForm from '../components/ProductForm';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';
import type { ProductInput } from '../types';

/** 发布商品页 */
export default function PublishPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { addProduct } = useMarket();
  const { success, error } = useNotify();

  const handleSubmit = (data: Omit<ProductInput, 'sellerId'>) => {
    if (!currentUser) {
      error('登录状态已失效，请重新登录');
      navigate('/login');
      return;
    }
    const product = addProduct({ ...data, sellerId: currentUser.id });
    success('发布成功，快去看看你的宝贝吧～');
    navigate(`/product/${product.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 md:text-2xl">
          发布闲置
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          信息越详细，越容易遇到有缘的买家～
        </p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        <ProductForm
          initial={{ contact: currentUser?.contact ?? '', campus: currentUser?.campus ?? '东校区' }}
          submitLabel="立即发布"
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  );
}
