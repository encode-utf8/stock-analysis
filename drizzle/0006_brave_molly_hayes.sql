CREATE TABLE "fund_news_items" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"sentiment" text NOT NULL,
	"confidence" double precision NOT NULL,
	"impact_days" integer NOT NULL,
	"expire_at" timestamp with time zone NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"news_type" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fund_news_items_code_expire_idx" ON "fund_news_items" USING btree ("code","expire_at");--> statement-breakpoint
CREATE INDEX "fund_news_items_status_expire_idx" ON "fund_news_items" USING btree ("status","expire_at");