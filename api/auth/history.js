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
    const { data: generations, error } = await supabase
      .from('headshot_generations')
      .select('*')
      .eq('user_id', decoded.userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch history' });
    }
    res.status(200).json({
      success: true,
      history: generations
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
} 