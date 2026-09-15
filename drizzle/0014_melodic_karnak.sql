ALTER TABLE "fund_positions" ADD COLUMN "manual_anchor_date" text;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "manual_anchor_nav" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "manual_anchor_source" text;