CREATE TABLE "fund_analysis_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"data_snapshot" jsonb,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text NOT NULL,
	"risk_note" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fund_analysis_reports_code_created_idx" ON "fund_analysis_reports" USING btree ("code","created_at");--> statement-breakpoint
CREATE INDEX "fund_conversations_code_created_idx" ON "fund_conversations" USING btree ("code","created_at");--> statement-breakpoint
CREATE INDEX "fund_messages_conversation_created_idx" ON "fund_messages" USING btree ("conversation_id","created_at");