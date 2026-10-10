-- The platform displays listings and shares seller-selected contact information.
-- Existing contacts remain private; historical trade data is retained but no longer used.
ALTER TABLE products ADD COLUMN contact_public boolean NOT NULL DEFAULT false;
UPDATE products SET status = '在售' WHERE status = '预约中';
CREATE TABLE contact_requests (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES products(id),
    buyer_id uuid NOT NULL REFERENCES users(id),
    seller_id uuid NOT NULL REFERENCES users(id),
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_id, buyer_id),
    CHECK (buyer_id <> seller_id)
);
CREATE INDEX contact_requests_seller ON contact_requests(seller_id, created_at DESC);
