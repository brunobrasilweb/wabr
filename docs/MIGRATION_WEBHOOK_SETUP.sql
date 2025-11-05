-- Migration for Webhook functionality

-- Create whatsapp_webhooks table
CREATE TABLE IF NOT EXISTS whatsapp_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id INTEGER NOT NULL,
    phone_number VARCHAR(32) NOT NULL,
    webhook_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    failure_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    last_success_at TIMESTAMP WITH TIME ZONE,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, phone_number)
);

-- Create indexes for whatsapp_webhooks
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhooks_client_id_active 
    ON whatsapp_webhooks(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhooks_client_id_phone 
    ON whatsapp_webhooks(client_id, phone_number);

-- Create whatsapp_webhook_events table
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL,
    message_id VARCHAR(64) NOT NULL,
    from VARCHAR(32) NOT NULL,
    to VARCHAR(32) NOT NULL,
    message_type VARCHAR(32) NOT NULL DEFAULT 'text',
    content TEXT,
    payload JSONB NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    http_status INTEGER,
    response TEXT,
    error TEXT,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (webhook_id) REFERENCES whatsapp_webhooks(id) ON DELETE CASCADE
);

-- Create indexes for whatsapp_webhook_events
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_webhook_id_status 
    ON whatsapp_webhook_events(webhook_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_message_id 
    ON whatsapp_webhook_events(message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_created_at 
    ON whatsapp_webhook_events(created_at DESC);

-- Populate metadata column for existing webhooks (if migrating from existing setup)
-- This query would add a field to track configuration:
-- UPDATE whatsapp_webhooks SET metadata = jsonb_build_object('created_from', 'migration') WHERE metadata IS NULL;
