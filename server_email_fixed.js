import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Initialize Supabase with both keys
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from Supabase
    const { data: user, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      console.error('User fetch error:', error);
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};

// Routes

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Authentication routes
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log('Creating user:', email);

    // Create user in Supabase Auth with email confirmation disabled
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName || '' },
      email_confirm: true // FIXED: Set to true to skip email confirmation
    });

    if (authError) {
      console.error('Signup error:', authError);
      return res.status(400).json({ error: authError.message });
    }

    console.log('User created in auth, ID:', authData.user.id);

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the created profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error after creation:', profileError);
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: fullName || '',
        credits: profile?.credits || 10
      },
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log('Login attempt for:', email);

    // First check if user exists and confirm them if needed
    const { data: existingUser, error: userError } = await supabaseAdmin.auth.admin.getUserByEmail(email);

    if (existingUser && existingUser.user && !existingUser.user.email_confirmed_at) {
      console.log('User exists but not confirmed, confirming now...');

      // Confirm the user's email
      const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.user.id,
        { email_confirm: true }
      );

      if (confirmError) {
        console.error('Email confirmation error:', confirmError);
      } else {
        console.log('User email confirmed successfully');
      }
    }

    // Now try to sign in
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('Login auth error:', authError);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('Auth successful, fetching profile for:', authData.user.id);

    // Get user profile using admin client
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return res.status(500).json({ error: 'Failed to fetch user profile' });
    }

    console.log('Profile fetched:', profile);

    // Create JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email: authData.user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      message: 'Logged in successfully!',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: profile?.full_name || '',
        credits: profile?.credits || 0
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// User profile routes
app.get('/api/profile', authenticateUser, async (req, res) => {
  try {
    console.log('Fetching profile for user:', req.user.id);

    // Get updated user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
    }

    // Get recent generations
    const { data: recentGenerations, error: generationsError } = await supabaseAdmin
      .from('headshot_generations')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (generationsError) {
      console.error('Generations fetch error:', generationsError);
    }

    // Get transactions
    const { data: transactions, error: transactionsError } = await supabaseAdmin
      .from('credit_transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (transactionsError) {
      console.error('Transactions fetch error:', transactionsError);
    }

    console.log('Profile data:', {
      profile: profile || req.user,
      generationsCount: recentGenerations?.length || 0,
      transactionsCount: transactions?.length || 0
    });

    res.json({
      success: true,
      profile: profile || req.user,
      recentGenerations: recentGenerations || [],
      transactions: transactions || []
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Generate headshot route (protected)
app.post('/generate-headshot', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Check if user has enough credits
    if (req.user.credits < 1) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(402).json({ 
        error: 'Insufficient credits', 
        details: 'You need at least 1 credit to generate a headshot. Please purchase more credits.' 
      });
    }

    const { gender = 'none', background = 'neutral', aspectRatio = '1:1', seed } = req.body;

    console.log('Processing headshot generation for user:', req.user.email);
    console.log('File:', req.file.filename);
    console.log('Parameters:', { gender, background, aspectRatio, seed });
    console.log('User credits:', req.user.credits);

    // Convert uploaded file to data URI
    const imageBuffer = fs.readFileSync(req.file.path);
    const imageDataUri = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Prepare input for the model
    const input = {
      input_image: imageDataUri,
      gender: gender,
      background: background,
      aspect_ratio: aspectRatio
    };

    // Add seed if provided
    if (seed && seed.trim() !== '') {
      input.seed = parseInt(seed);
    }

    // Deduct credit first (optimistic approach)
    const { error: creditError } = await supabaseAdmin.rpc('update_user_credits', {
      user_uuid: req.user.id,
      credit_change: -1,
      transaction_type: 'usage',
      description: 'Professional headshot generation'
    });

    if (creditError) {
      console.error('Credit deduction error:', creditError);
      fs.unlinkSync(req.file.path);
      return res.status(402).json({ error: 'Failed to deduct credits' });
    }

    // Run the model
    const output = await replicate.run("flux-kontext-apps/professional-headshot", { input });

    // Record the generation
    const { error: recordError } = await supabaseAdmin
      .from('headshot_generations')
      .insert({
        user_id: req.user.id,
        image_url: output,
        parameters: { gender, background, aspectRatio, seed },
        credits_used: 1,
        status: 'completed'
      });

    if (recordError) {
      console.error('Generation record error:', recordError);
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Get updated credits
    const { data: updatedProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('credits')
      .eq('id', req.user.id)
      .single();

    console.log('Headshot generated successfully');
    res.json({ 
      success: true, 
      imageUrl: output,
      message: 'Professional headshot generated successfully!',
      creditsRemaining: updatedProfile?.credits || 0
    });

  } catch (error) {
    console.error('Error generating headshot:', error);

    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Refund credit if generation failed
    try {
      await supabaseAdmin.rpc('update_user_credits', {
        user_uuid: req.user.id,
        credit_change: 1,
        transaction_type: 'refund',
        description: 'Refund for failed generation'
      });
    } catch (refundError) {
      console.error('Refund error:', refundError);
    }

    res.status(500).json({ 
      error: 'Failed to generate headshot', 
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Professional Headshot API with Authentication is running' });
});

// Check authentication status
app.get('/api/auth/status', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.auth_token;

    if (!token) {
      return res.json({ authenticated: false });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from Supabase
    const { data: user, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.json({ authenticated: false });
    }

    res.json({ 
      authenticated: true, 
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        credits: user.credits
      }
    });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

app.listen(port, () => {
  console.log(`Professional Headshot App with Authentication running at http://localhost:${port}`);
  console.log('Features enabled:');
  console.log('- User Authentication (Signup/Login)');
  console.log('- Credits System');
  console.log('- Usage Tracking');
  console.log('- Protected Headshot Generation');
  console.log('- Dashboard with Statistics');
  console.log('- Email Confirmation Disabled for Development');
});
