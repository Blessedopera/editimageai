# AI Image Editor

A powerful web application that allows users to edit images using natural language prompts with the Flux Kontext Pro AI model from Replicate.

## Features

- **AI-Powered Image Editing**: Transform any image using natural language descriptions
- **User Authentication**: Secure login/signup system with Supabase
- **Credit System**: Pay-per-use model with credit management
- **Dashboard**: Track your editing history and credit usage
- **Multiple Output Formats**: Support for JPG, PNG, and WebP formats
- **Real-time Processing**: Fast image editing with progress indicators

## Technology Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js with Express
- **Database**: Supabase (PostgreSQL)
- **AI Model**: Flux Kontext Pro (black-forest-labs/flux-kontext-pro)
- **Authentication**: JWT with Supabase Auth
- **Payment Processing**: Stripe
- **File Upload**: Multer
- **Deployment**: Vercel

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Replicate API
REPLICATE_API_TOKEN=your_replicate_api_token

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
SUPABASE_ANON_KEY=your_supabase_anon_key

# JWT
JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

### 2. Database Setup

Run the SQL commands from `database_schema.sql` in your Supabase SQL Editor to create the necessary tables and functions.

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Application

```bash
npm start
```

The application will be available at `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout

### Image Editing
- `POST /generate-image-edit` - Edit an image with AI
- `GET /api/user/history` - Get user's editing history
- `GET /api/user/profile` - Get user profile

### Credits
- `POST /api/credits/purchase` - Purchase credits
- `POST /api/auth/create-checkout-session` - Create Stripe checkout session

## Usage

1. **Sign up/Login**: Create an account or sign in to get started
2. **Upload Image**: Select an image file (JPG, PNG, WebP, GIF up to 10MB)
3. **Enter Prompt**: Describe how you want to edit the image (e.g., "Make this a 90s cartoon", "Change the background to a beach")
4. **Select Format**: Choose your preferred output format
5. **Generate**: Click "Edit Image" to process your request (costs 1 credit)
6. **Download**: Save your edited image

## Credit System

- New users receive 10 free credits
- Each image edit costs 1 credit
- Credits can be purchased through various plans:
  - Starter: 25 credits for $9.99
  - Popular: 60 credits for $19.99
  - Professional: 150 credits for $39.99
  - Business: 300 credits for $69.99

## Database Schema

### Tables
- `user_profiles`: User information and credit balance
- `image_edits`: Image editing history and results
- `credit_transactions`: Credit purchase and usage tracking

### Functions
- `handle_new_user()`: Automatically creates user profile on signup
- `update_user_credits()`: Manages credit transactions

## Deployment

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Set up environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

### Environment Variables for Production

Make sure to set all required environment variables in your Vercel project settings.

## Security Features

- JWT-based authentication
- Row Level Security (RLS) in Supabase
- Secure file upload validation
- Credit system to prevent abuse
- Input validation and sanitization

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support, please open an issue in the GitHub repository or contact the development team.
