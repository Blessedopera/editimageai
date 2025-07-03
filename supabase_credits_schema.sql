-- Enhanced Supabase Schema for Credits System
-- Run this in your Supabase SQL Editor

-- Add credit packages table
CREATE TABLE IF NOT EXISTS credit_packages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    credits INTEGER NOT NULL,
    price_cents INTEGER NOT NULL, -- Store price in cents (e.g., 999 = $9.99)
    bonus_percentage INTEGER DEFAULT 0,
    popular BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add credit transactions table
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES credit_packages(id),
    credits_purchased INTEGER NOT NULL,
    amount_paid_cents INTEGER NOT NULL,
    payment_method VARCHAR(20) DEFAULT 'mock', -- 'stripe', 'mock', 'admin'
    payment_id VARCHAR(255), -- Stripe payment intent ID or mock ID
    status VARCHAR(20) DEFAULT 'completed', -- 'pending', 'completed', 'failed', 'refunded'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default credit packages
INSERT INTO credit_packages (name, credits, price_cents, bonus_percentage, popular) VALUES
('Starter Pack', 10, 999, 0, FALSE),
('Popular Pack', 25, 1999, 25, TRUE),
('Pro Pack', 50, 3499, 43, FALSE),
('Ultimate Pack', 100, 5999, 67, FALSE)
ON CONFLICT DO NOTHING;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_packages_active ON credit_packages(active) WHERE active = TRUE;

-- Add RLS (Row Level Security) policies
ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read active credit packages
CREATE POLICY "Anyone can view active credit packages" ON credit_packages
    FOR SELECT USING (active = TRUE);

-- Users can only see their own transactions
CREATE POLICY "Users can view own transactions" ON credit_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Only authenticated users can insert transactions (server will handle this)
CREATE POLICY "Authenticated users can insert transactions" ON credit_transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create a function to add credits to user profile
CREATE OR REPLACE FUNCTION add_credits_to_user(
    target_user_id UUID,
    credits_to_add INTEGER,
    transaction_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update user credits
    UPDATE user_profiles 
    SET 
        credits = credits + credits_to_add,
        updated_at = NOW()
    WHERE user_id = target_user_id;

    -- Check if update was successful
    IF FOUND THEN
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$;

-- Create a view for transaction history with package details
CREATE OR REPLACE VIEW user_transaction_history AS
SELECT 
    ct.id,
    ct.user_id,
    ct.credits_purchased,
    ct.amount_paid_cents,
    ct.payment_method,
    ct.status,
    ct.created_at,
    cp.name as package_name,
    cp.bonus_percentage
FROM credit_transactions ct
LEFT JOIN credit_packages cp ON ct.package_id = cp.id
ORDER BY ct.created_at DESC;

-- Grant necessary permissions
GRANT SELECT ON credit_packages TO anon, authenticated;
GRANT SELECT ON user_transaction_history TO authenticated;
GRANT EXECUTE ON FUNCTION add_credits_to_user TO authenticated;

-- Add some sample data for testing (optional)
-- You can remove this section if you don't want test data
INSERT INTO credit_transactions (
    user_id, 
    package_id, 
    credits_purchased, 
    amount_paid_cents, 
    payment_method, 
    payment_id, 
    status
) VALUES (
    (SELECT id FROM auth.users LIMIT 1), -- Gets first user for testing
    1, -- Starter pack
    10,
    999,
    'mock',
    'mock_' || extract(epoch from now()),
    'completed'
) ON CONFLICT DO NOTHING;

COMMENT ON TABLE credit_packages IS 'Available credit packages for purchase';
COMMENT ON TABLE credit_transactions IS 'Record of all credit purchases and transactions';
COMMENT ON FUNCTION add_credits_to_user IS 'Safely adds credits to a user profile';
