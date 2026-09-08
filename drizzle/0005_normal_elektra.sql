CREATE TABLE "fund_holdings" (
	"code" text NOT NULL,
	"report_date" text NOT NULL,
	"published_at" timestamp with time zone,
	"top_holdings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_allocation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"industry_allocation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"top10_weight_pct" double precision,
	"top1_weight_pct" double precision,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fund_holdings_code_report_date_pk" PRIMARY KEY("code","report_date")
);
--> statement-breakpoint
CREATE TABLE "fund_navs" (
	"code" text NOT NULL,
	"nav_date" timestamp with time zone NOT NULL,
	"unit_nav" double precision NOT NULL,
	"cumulative_nav" double precision NOT NULL,
	"daily_change_pct" double precision,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fund_navs_code_nav_date_pk" PRIMARY KEY("code","nav_date")
);
--> statement-breakpoint
CREATE TABLE "fund_profiles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"trading_mode" text NOT NULL,
	"manager" text,
	"company" text,
	"benchmark" text,
	"establish_date" text,
	"scale" double precision,
	"risk_level" text,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_risk_metrics" (
	"code" text NOT NULL,
	"range" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"max_drawdown_pct" double precision NOT NULL,
	"max_drawdown_start" text NOT NULL,
	"max_drawdown_end" text NOT NULL,
	"current_drawdown_pct" double precision NOT NULL,
	"max_drawdown_recovery_start" text NOT NULL,
	"max_drawdown_recovery_end" text,
	"max_drawdown_recovery_complete" boolean DEFAULT false NOT NULL,
	"longest_recovery_days" integer,
	"average_recovery_days" integer,
	"current_recovery_progress_pct" double precision,
	"annualized_return_pct" double precision,
	"annualized_volatility_pct" double precision,
	"sharpe" double precision,
	"sortino" double precision,
	"calmar" double precision,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fund_risk_metrics_code_range_pk" PRIMARY KEY("code","range")
);
--> statement-breakpoint
CREATE INDEX "fund_holdings_code_date_idx" ON "fund_holdings" USING btree ("code","report_date");--> statement-breakpoint
CREATE INDEX "fund_navs_code_date_idx" ON "fund_navs" USING btree ("code","nav_date");