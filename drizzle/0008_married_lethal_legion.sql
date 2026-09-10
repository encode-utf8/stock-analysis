CREATE TABLE "alert_events" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"target" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"logic" text NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"level" text DEFAULT 'warn' NOT NULL,
	"message" text NOT NULL,
	"email_status" text DEFAULT 'skipped' NOT NULL,
	"email_reason" text,
	"status" text DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"logic" text DEFAULT 'and' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_hours" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_triggered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "alert_events_created_at_idx" ON "alert_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_events_status_idx" ON "alert_events" USING btree ("status");