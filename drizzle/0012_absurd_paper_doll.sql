ALTER TABLE "fund_positions" ADD COLUMN "dca_frequency" text;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "dca_weekday" integer;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "dca_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "dca_start_date" text;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "calib_nav_date" text;--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "calib_shares" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "fund_positions" ADD COLUMN "calib_cost" numeric(18, 2);