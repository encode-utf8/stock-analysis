CREATE TABLE "fund_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"profit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_positions_code_idx" ON "fund_positions" USING btree ("code");