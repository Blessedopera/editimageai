const express = require('express');
const multer = require('multer');
const Replicate = require('replicate');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
        }
    }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    try {
        const token = req.cookies.authToken;

        if (!token) {
            return res.status(401).json({ error: 'No authentication token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data from Supabase
        const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', decoded.userId)
            .single();

        if (error || !profile) {
            return res.status(401).json({ error: 'Invalid token or user not found' });
        }

        req.user = {
            id: decoded.userId,
            email: decoded.email,
            ...profile
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Authentication routes
app.post('/auth/signup', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email and password are required' 
            });
        }

        // Check if user already exists
        const { data: existingUser } = await supabase.auth.getUser();

        // Sign up with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName || ''
                }
            }
        });

        if (authError) {
            console.error('Supabase auth error:', authError);
            return res.status(400).json({ 
                success: false, 
                error: authError.message 
            });
        }

        if (!authData.user) {
            return res.status(400).json({ 
                success: false, 
                error: 'Failed to create user account' 
            });
        }

        // Create user profile with initial credits
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .insert([
                {
                    user_id: authData.user.id,
                    email: email,
                    full_name: fullName || '',
                    credits: 10 // Free starter credits
                }
            ])
            .select()
            .single();

        if (profileError) {
            console.error('Profile creation error:', profileError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create user profile' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: authData.user.id, 
                email: email 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set HTTP-only cookie
        res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            success: true,
            user: {
                id: authData.user.id,
                email: email,
                fullName: fullName || '',
                credits: 10
            },
            token: token
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during signup' 
        });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email and password are required' 
            });
        }

        // Sign in with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError || !authData.user) {
            console.error('Login error:', authError);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid email or password' 
            });
        }

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', authData.user.id)
            .single();

        if (profileError || !profile) {
            console.error('Profile fetch error:', profileError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch user profile' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: authData.user.id, 
                email: email 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set HTTP-only cookie
        res.cookie('authToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            success: true,
            user: {
                id: authData.user.id,
                email: profile.email,
                fullName: profile.full_name,
                credits: profile.credits
            },
            token: token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during login' 
        });
    }
});

app.post('/auth/logout', (req, res) => {
    res.clearCookie('authToken');
    res.json({ success: true });
});

app.get('/api/auth/status', authenticateToken, (req, res) => {
    res.json({
        authenticated: true,
        user: {
            id: req.user.user_id,
            email: req.user.email,
            fullName: req.user.full_name,
            credits: req.user.credits
        }
    });
});

// Credits API routes
app.get('/api/credit-packages', authenticateToken, async (req, res) => {
    try {
        const { data: packages, error } = await supabase
            .from('credit_packages')
            .select('*')
            .eq('active', true)
            .order('price_cents', { ascending: true });

        if (error) {
            console.error('Error fetching credit packages:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch credit packages' 
            });
        }

        res.json({
            success: true,
            packages: packages || []
        });

    } catch (error) {
        console.error('Credit packages error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

app.post('/api/purchase-credits', authenticateToken, async (req, res) => {
    try {
        const { packageId } = req.body;
        const userId = req.user.user_id;

        if (!packageId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Package ID is required' 
            });
        }

        // Get package details
        const { data: package, error: packageError } = await supabase
            .from('credit_packages')
            .select('*')
            .eq('id', packageId)
            .eq('active', true)
            .single();

        if (packageError || !package) {
            return res.status(404).json({ 
                success: false, 
                error: 'Credit package not found' 
            });
        }

        // In a real app, this is where you'd process the Stripe payment
        // For now, we'll simulate a successful payment
        const mockPaymentId = `mock_payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create transaction record
        const { data: transaction, error: transactionError } = await supabase
            .from('credit_transactions')
            .insert([
                {
                    user_id: userId,
                    package_id: packageId,
                    credits_purchased: package.credits,
                    amount_paid_cents: package.price_cents,
                    payment_method: 'mock',
                    payment_id: mockPaymentId,
                    status: 'completed',
                    metadata: {
                        package_name: package.name,
                        mock_purchase: true,
                        timestamp: new Date().toISOString()
                    }
                }
            ])
            .select()
            .single();

        if (transactionError) {
            console.error('Transaction creation error:', transactionError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create transaction record' 
            });
        }

        // Add credits to user profile
        const { data: updatedProfile, error: updateError } = await supabase
            .from('user_profiles')
            .update({ 
                credits: req.user.credits + package.credits,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select()
            .single();

        if (updateError) {
            console.error('Profile update error:', updateError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update user credits' 
            });
        }

        res.json({
            success: true,
            message: `Successfully purchased ${package.credits} credits!`,
            transactionId: transaction.id,
            creditsAdded: package.credits,
            newCreditsBalance: updatedProfile.credits,
            package: {
                name: package.name,
                credits: package.credits,
                price: package.price_cents / 100
            }
        });

    } catch (error) {
        console.error('Purchase credits error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during purchase' 
        });
    }
});

app.get('/api/transaction-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.user_id;

        const { data: transactions, error } = await supabase
            .from('user_transaction_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error('Error fetching transaction history:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch transaction history' 
            });
        }

        res.json({
            success: true,
            transactions: transactions || []
        });

    } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Profile and dashboard routes
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.user_id;

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (profileError) {
            console.error('Profile fetch error:', profileError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch user profile' 
            });
        }

        // Get recent generations
        const { data: generations, error: generationsError } = await supabase
            .from('headshot_generations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (generationsError) {
            console.error('Generations fetch error:', generationsError);
        }

        res.json({
            success: true,
            profile: profile,
            recentGenerations: generations || []
        });

    } catch (error) {
        console.error('Profile API error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Headshot generation route
app.post('/generate-headshot', authenticateToken, upload.single('image'), async (req, res) => {
    let tempFilePath = null;

    try {
        // Check if user has enough credits
        if (req.user.credits < 1) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient credits. You need at least 1 credit to generate a headshot.',
                creditsRemaining: req.user.credits
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No image file uploaded'
            });
        }

        tempFilePath = req.file.path;

        // Read the uploaded file
        const imageBuffer = fs.readFileSync(tempFilePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imageDataUri = `data:${req.file.mimetype};base64,${imageBase64}`;

        console.log('Starting headshot generation for user:', req.user.email);

        // Prepare parameters
        const parameters = {
            input_image: imageDataUri,
            gender: req.body.gender !== 'none' ? req.body.gender : undefined,
            background: req.body.background || 'neutral',
            aspect_ratio: req.body.aspectRatio || '1:1'
        };

        // Add seed if provided
        if (req.body.seed && req.body.seed.trim() !== '') {
            parameters.seed = parseInt(req.body.seed);
        }

        console.log('Generation parameters:', {
            ...parameters,
            input_image: '[base64 data]' // Don't log the actual image data
        });

        // Run the model
        const output = await replicate.run(
            "flux-kontext-apps/professional-headshot:b8b6b5b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8",
            { input: parameters }
        );

        console.log('Replicate output:', output);

        let imageUrl;
        if (Array.isArray(output) && output.length > 0) {
            imageUrl = output[0];
        } else if (typeof output === 'string') {
            imageUrl = output;
        } else {
            throw new Error('Unexpected output format from Replicate');
        }

        // Deduct credit from user
        const { data: updatedProfile, error: updateError } = await supabase
            .from('user_profiles')
            .update({ 
                credits: req.user.credits - 1,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', req.user.user_id)
            .select()
            .single();

        if (updateError) {
            console.error('Failed to update user credits:', updateError);
            // Continue anyway, but log the error
        }

        // Save generation record
        const { error: saveError } = await supabase
            .from('headshot_generations')
            .insert([
                {
                    user_id: req.user.user_id,
                    image_url: imageUrl,
                    parameters: parameters,
                    credits_used: 1,
                    status: 'completed'
                }
            ]);

        if (saveError) {
            console.error('Failed to save generation record:', saveError);
            // Continue anyway, but log the error
        }

        res.json({
            success: true,
            imageUrl: imageUrl,
            message: 'Professional headshot generated successfully!',
            creditsRemaining: updatedProfile ? updatedProfile.credits : req.user.credits - 1,
            parameters: {
                gender: parameters.gender || 'auto-detect',
                background: parameters.background,
                aspectRatio: parameters.aspect_ratio,
                seed: parameters.seed || 'random'
            }
        });

    } catch (error) {
        console.error('Headshot generation error:', error);

        let errorMessage = 'Failed to generate headshot';
        let errorDetails = error.message;

        if (error.message.includes('NSFW')) {
            errorMessage = 'Image rejected: Content not suitable for professional headshots';
            errorDetails = 'Please upload a different image that shows a clear face without inappropriate content.';
        } else if (error.message.includes('face')) {
            errorMessage = 'No clear face detected in the image';
            errorDetails = 'Please upload an image with a clearly visible face for best results.';
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Generation timed out';
            errorDetails = 'The AI service is currently busy. Please try again in a few moments.';
        }

        res.status(500).json({
            success: false,
            error: errorMessage,
            details: errorDetails,
            creditsRemaining: req.user.credits
        });
    } finally {
        // Clean up temporary file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.error('Failed to cleanup temp file:', cleanupError);
            }
        }
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 10MB.'
            });
        }
    }

    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving static files from 'public' directory`);
    console.log(`🔑 Make sure your .env file contains:`);
    console.log(`   - REPLICATE_API_TOKEN`);
    console.log(`   - SUPABASE_URL`);
    console.log(`   - SUPABASE_ANON_KEY`);
    console.log(`   - JWT_SECRET`);
});

module.exports = app;
