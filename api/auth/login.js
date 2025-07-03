import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    // Sign in with Supabase Auth (use anon client)
    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });
    if (authError) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    if (profileError) {
      console.error('Profile fetch error:', profileError);
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
      message: 'Login successful!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: profile?.full_name || '',
        credits: profile?.credits || 0,
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
} 