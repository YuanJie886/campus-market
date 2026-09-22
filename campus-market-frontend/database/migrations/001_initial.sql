CREATE TABLE schools (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE campuses (id text PRIMARY KEY, school_id text NOT NULL REFERENCES schools, name text NOT NULL);
CREATE TABLE meeting_points (id text PRIMARY KEY, campus_id text NOT NULL REFERENCES campuses, name text NOT NULL);
CREATE TABLE users (
 id uuid PRIMARY KEY, account text NOT NULL UNIQUE, password_hash text NOT NULL,
 nickname text NOT NULL, avatar text NOT NULL DEFAULT '', campus text NOT NULL REFERENCES campuses(id),
 contact text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, refresh_hash text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
 id uuid PRIMARY KEY, seller_id uuid NOT NULL REFERENCES users,
 title text NOT NULL, description text NOT NULL, price numeric(12,2) NOT NULL CHECK(price>=0),
 category text NOT NULL, condition text NOT NULL, campus text NOT NULL REFERENCES campuses(id),
 images jsonb NOT NULL DEFAULT '[]', contact text NOT NULL DEFAULT '', original_price numeric(12,2),
 status text NOT NULL DEFAULT '在售' CHECK(status IN ('在售','已售出','已下架','预约中')),
 views integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), sold_at timestamptz
);
CREATE INDEX products_campus_created ON products(campus, created_at DESC);
CREATE INDEX products_seller ON products(seller_id);
CREATE TABLE favorites (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, product_id uuid NOT NULL REFERENCES products,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,product_id)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products, buyer_id uuid NOT NULL REFERENCES users,
 seller_id uuid NOT NULL REFERENCES users, price numeric(12,2) NOT NULL CHECK(price>=0),
 status text NOT NULL CHECK(status IN ('PENDING_SELLER_CONFIRM','PENDING_MEETING','BUYER_CONFIRMED','SELLER_CONFIRMED','COMPLETED','CANCELLED','EXPIRED','DISPUTED')),
 meeting_point_id text NOT NULL REFERENCES meeting_points, meeting_at timestamptz NOT NULL,
 contact text NOT NULL, confirmation_code text NOT NULL, code_attempts integer NOT NULL DEFAULT 0,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(buyer_id<>seller_id), UNIQUE(buyer_id,idempotency_key)
);
CREATE UNIQUE INDEX one_active_order_per_product ON orders(product_id) WHERE status NOT IN ('CANCELLED','EXPIRED','COMPLETED');
CREATE INDEX orders_buyer ON orders(buyer_id);
CREATE INDEX orders_seller ON orders(seller_id);
CREATE TABLE order_events (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders, actor_id uuid REFERENCES users,
 from_status text, to_status text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reviews (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders, reviewer_id uuid NOT NULL REFERENCES users,
 rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5), comment text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(order_id,reviewer_id)
);
CREATE TABLE comments (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products, user_id uuid NOT NULL REFERENCES users,
 content text NOT NULL, parent_id uuid REFERENCES comments, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products, buyer_id uuid NOT NULL REFERENCES users,
 seller_id uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,buyer_id), CHECK(buyer_id<>seller_id)
);
CREATE TABLE messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations, sender_id uuid NOT NULL REFERENCES users,
 content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_created ON messages(conversation_id,created_at);
CREATE TABLE conversation_reads (
 conversation_id uuid NOT NULL REFERENCES conversations, user_id uuid NOT NULL REFERENCES users,
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(conversation_id,user_id)
);
INSERT INTO schools VALUES ('pilot','试点学校（请部署时配置）');
INSERT INTO campuses SELECT name,'pilot',name FROM unnest(ARRAY['东校区','西校区','南校区','北校区']) name;
INSERT INTO meeting_points SELECT id||'-library',id,'图书馆门口' FROM campuses;
INSERT INTO meeting_points SELECT id||'-canteen',id,'食堂入口' FROM campuses;
INSERT INTO meeting_points SELECT id||'-express',id,'快递站' FROM campuses;
