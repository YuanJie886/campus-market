import type { DemandSubscription, Product } from "../types";

// A review window for the pilot. Public visibility resumes when the seller confirms availability.
export const LISTING_REVIEW_DAYS = 30;
export const LISTING_REVIEW_WINDOW_MS = LISTING_REVIEW_DAYS * 24 * 60 * 60 * 1000;

export function isListingStale(product: Product, now = Date.now()): boolean {
  const lastConfirmedAt = product.lastConfirmedAt ?? product.createdAt;
  return product.status === "在售" && now - lastConfirmedAt >= LISTING_REVIEW_WINDOW_MS;
}

export function matchesDemand(product: Product, demand: DemandSubscription): boolean {
  if (!demand.active || product.status !== "在售" || isListingStale(product)) return false;
  if (demand.keyword) {
    const keyword = demand.keyword.trim().toLocaleLowerCase();
    if (!`${product.title} ${product.description}`.toLocaleLowerCase().includes(keyword)) return false;
  }
  if (demand.category && product.category !== demand.category) return false;
  if (demand.campus && product.campus !== demand.campus) return false;
  if (demand.minPrice !== undefined && product.price < demand.minPrice) return false;
  if (demand.maxPrice !== undefined && product.price > demand.maxPrice) return false;
  return true;
}
