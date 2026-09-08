CREATE TABLE "fund_watchlist" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"trading_mode" text NOT NULL,
	"group" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"sort_order" integer NOT NULL,
	"note" text
);
