import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    // Create user in Supabase Auth (regular signup, not admin, use anon client)
    const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || '' }
      }
    });
    if (authError) {
      console.error('Signup error:', authError);
      return res.status(400).json({ error: authError.message });
    }
    // Force email verification using admin API
    if (authData.user && !authData.user.email_confirmed_at) {
      const { error: confirmError } = await supabase.auth.admin.updateUserById(authData.user.id, { email_confirm: true });
      if (confirmError) {
        console.error('Email confirm error:', confirmError);
        // Not fatal, continue
      }
    }
    // Wait for user_profiles row to exist (handle Supabase trigger timing)
    let profile = null;
    let tries = 0;
    const maxTries = 7;
    const delay = ms => new Promise(res => setTimeout(res, ms));
    while (tries < maxTries) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (data && !error) {
        profile = data;
        break;
      }
      await delay(300); // wait 300ms before retry
      tries++;
    }
    // If profile still not found, insert it manually
    if (!profile) {
      const { error: insertError } = await supabase
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email: authData.user.email,
          full_name: fullName || '',
          credits: 10,
          total_credits_purchased: 0
        });
      if (insertError) {
        console.error('Manual profile insert error:', insertError);
        return res.status(500).json({ error: 'Failed to create user profile. Please try again.' });
      }
      // Fetch the newly inserted profile
      const { data: newProfile, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', authData.user.id)
        .single();
      if (newProfile && !fetchError) {
        profile = newProfile;
      } else {
        return res.status(500).json({ error: 'Failed to create user profile. Please try again.' });
      }
    }
    // Create JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    // Set cookie
    res.setHeader('Set-Cookie', `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax;${process.env.NODE_ENV === 'production' ? ' Secure;' : ''}`);
    res.status(200).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        credits: profile.credits,
        totalCreditsPurchased: profile.total_credits_purchased,
        createdAt: profile.created_at
      },
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
} 