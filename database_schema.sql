-- Supabase Database Schema for AI Image Editor
-- Run these SQL commands in your Supabase SQL Editor

-- 1. Create users table (extends Supabase auth.users)
CREATE TABLE public.user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  credits INTEGER DEFAULT 10, -- Free credits for new users
  total_credits_purchased INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create usage tracking table for image edits
CREATE TABLE public.image_edits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  image_url TEXT,
  parameters JSONB, -- Store generation parameters (prompt, output_format)
  credits_used INTEGER DEFAULT 1,
  status TEXT DEFAULT 'completed', -- completed, failed, processing
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create credit transactions table
CREATE TABLE public.credit_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  amount INTEGER NOT NULL, -- positive for purchases, negative for usage
  transaction_type TEXT NOT NULL, -- 'purchase', 'usage', 'bonus'
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies
-- Users can only see their own profile
CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can only see their own image edits
CREATE POLICY "Users can view own image edits" ON public.image_edits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own image edits" ON public.image_edits
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only see their own transactions
CREATE POLICY "Users can view own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- 6. Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, credits)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 10);

  -- Add welcome bonus transaction
  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description)
  VALUES (NEW.id, 10, 'bonus', 'Welcome bonus - 10 free credits');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create trigger for new user registration
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Create function to update credits
CREATE OR REPLACE FUNCTION public.update_user_credits(
  user_uuid UUID,
  credit_change INTEGER,
  transaction_type TEXT,
  description TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
BEGIN
  -- Get current credits
  SELECT credits INTO current_credits
  FROM public.user_profiles
  WHERE id = user_uuid;

  -- Check if user has enough credits for negative transactions
  IF credit_change < 0 AND current_credits + credit_change < 0 THEN
    RETURN FALSE; -- Insufficient credits
  END IF;

  -- Update user credits
  UPDATE public.user_profiles
  SET credits = credits + credit_change,
      updated_at = NOW()
  WHERE id = user_uuid;

  -- Record transaction
  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description)
  VALUES (user_uuid, credit_change, transaction_type, description);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
