import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ProductGrid from '../../components/ProductGrid';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';

/** 我的收藏 */
export default function FavoritesPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getFavoriteProducts } = useMarket();

  const favorites = currentUser ? getFavoriteProducts(currentUser.id) : [];

  return (
    <ProductGrid
      products={favorites}
      emptyTitle="还没有收藏任何商品"
      emptyDescription="看到心仪的闲置，点一下 ♡ 就能收藏到这里，随时回来查看～"
      emptyAction={
        <Button
          variant="contained"
          startIcon={<FavoriteBorderIcon />}
          onClick={() => navigate('/')}
        >
          去发现好物
        </Button>
      }
    />
  );
}
