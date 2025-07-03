import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const token = req.cookies?.auth_token || (req.headers.cookie || '').split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
    if (!token) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', decoded.userId)
      .single();
    if (error || !profile) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }
    res.status(200).json({
      success: true,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        credits: profile.credits,
        totalCreditsPurchased: profile.total_credits_purchased,
        createdAt: profile.created_at
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(401).json({ error: 'Invalid authentication token' });
  }
} 