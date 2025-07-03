import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Auth middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Routes

// Sign up
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Create user profile with initial credits
    if (data.user) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert([
          {
            user_id: data.user.id,
            email: data.user.email,
            credits: 3 // Give 3 free credits to new users
          }
        ]);

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }
    }

    res.json({ 
      message: 'User created successfully', 
      user: data.user,
      session: data.session 
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign in
app.post('/api/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ 
      message: 'Signed in successfully', 
      user: data.user,
      session: data.session 
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile
app.get('/api/profile', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error) {
      // If profile doesn't exist, create it
      if (error.code === 'PGRST116') {
        const { data: newProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert([
            {
              user_id: req.user.id,
              email: req.user.email,
              credits: 3
            }
          ])
          .select()
          .single();

        if (createError) {
          return res.status(500).json({ error: 'Failed to create profile' });
        }

        return res.json(newProfile);
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Buy credits
app.post('/api/buy-credits', authenticateUser, async (req, res) => {
  try {
    const { amount } = req.body;

    // In a real app, you'd integrate with a payment processor here
    // For now, we'll just add credits directly

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ 
        credits: supabase.raw(`credits + ${amount}`)
      })
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Record the transaction
    await supabase
      .from('credit_transactions')
      .insert([
        {
          user_id: req.user.id,
          amount: amount,
          type: 'purchase',
          description: `Purchased ${amount} credits`
        }
      ]);

    res.json({ 
      message: 'Credits purchased successfully', 
      credits: data.credits 
    });
  } catch (error) {
    console.error('Buy credits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate headshot
app.post('/api/generate', authenticateUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Check user credits
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('credits')
      .eq('user_id', req.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(500).json({ error: 'Failed to get user profile' });
    }

    if (profile.credits < 1) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    // Deduct credit
    const { error: deductError } = await supabase
      .from('user_profiles')
      .update({ 
        credits: profile.credits - 1
      })
      .eq('user_id', req.user.id);

    if (deductError) {
      return res.status(500).json({ error: 'Failed to deduct credit' });
    }

    // Record the transaction
    await supabase
      .from('credit_transactions')
      .insert([
        {
          user_id: req.user.id,
          amount: -1,
          type: 'usage',
          description: 'Generated professional headshot'
        }
      ]);

    // Generate the headshot
    const imagePath = path.join(__dirname, req.file.path);
    const fs = await import('fs');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    const output = await replicate.run(
      "tencentarc/photomaker:ddfc2b08d209f9fa8c1eca692712918bd449f695dabb4a958da31802a9570fe4",
      {
        input: {
          input_image: base64Image,
          prompt: "professional headshot, business attire, clean background, high quality, professional lighting",
          negative_prompt: "blurry, low quality, distorted, unprofessional",
          num_steps: 50,
          style_strength_ratio: 20,
          num_outputs: 1,
          guidance_scale: 5,
          seed: Math.floor(Math.random() * 1000000)
        }
      }
    );

    // Clean up uploaded file
    fs.unlinkSync(imagePath);

    res.json({ 
      success: true, 
      output: output,
      remaining_credits: profile.credits - 1
    });

  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Failed to generate headshot: ' + error.message });
  }
});

// Sign out
app.post('/api/signout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
