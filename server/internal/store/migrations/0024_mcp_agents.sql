-- MCP agents (V0.12): officers connect their own AI agents to /mcp with OAuth 2.1 + PKCE.
-- Clients register themselves (RFC 7591), the officer signs in and allows, and the agent
-- then acts as that officer. Only SHA-256 hashes of codes and tokens are stored.
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_hash` text NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_access` ON `oauth_grants` (`access_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_refresh` ON `oauth_grants` (`refresh_hash`);
--> statement-breakpoint
CREATE INDEX `oauth_grants_user` ON `oauth_grants` (`user_id`);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD `actor_agent_id` text REFERENCES `oauth_grants`(`id`);
