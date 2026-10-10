import { useParams } from "react-router-dom";
import MarketResultsPage from "./MarketResultsPage";
import { CATEGORIES } from "../types";
import type { Category } from "../types";

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const category = decodeURIComponent(slug ?? "") as Category;
  return <MarketResultsPage category={CATEGORIES.includes(category) ? category : undefined} />;
}
