CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"corrected_at" timestamp with time zone,
	"download_mbps" double precision NOT NULL,
	"upload_mbps" double precision NOT NULL,
	"idle_median_ms" double precision NOT NULL,
	"idle_p95_ms" double precision NOT NULL,
	"jitter_ms" double precision NOT NULL,
	"request_loss_pct" double precision NOT NULL,
	"loaded_download_ms" double precision NOT NULL,
	"loaded_upload_ms" double precision NOT NULL,
	"grade" text NOT NULL,
	"bytes_used" integer NOT NULL,
	"duration_ms" double precision NOT NULL,
	"low_data" boolean NOT NULL,
	"engine_version" text NOT NULL,
	"server_id" text NOT NULL,
	"isp_slug" text NOT NULL,
	"state_slug" text,
	"lga_slug" text,
	"network_type" text NOT NULL,
	"device_class" text NOT NULL,
	"token_hash" text NOT NULL,
	"owner_hash" text NOT NULL,
	"ip_hash" text,
	"flag" text,
	CONSTRAINT "results_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "results_created_at_idx" ON "results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "results_isp_created_at_idx" ON "results" USING btree ("isp_slug","created_at");--> statement-breakpoint
CREATE INDEX "results_state_created_at_idx" ON "results" USING btree ("state_slug","created_at");--> statement-breakpoint
CREATE INDEX "results_owner_hash_idx" ON "results" USING btree ("owner_hash");--> statement-breakpoint
CREATE INDEX "results_ip_hash_created_at_idx" ON "results" USING btree ("ip_hash","created_at") WHERE "results"."ip_hash" is not null;