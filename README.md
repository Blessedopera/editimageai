# Professional Headshot Generator

Transform any photo into a professional headshot using AI (Replicate) and Supabase for authentication and credits.

## Features

- 📸 Upload any image (JPG, PNG, WebP, GIF)
- 🎯 Generate professional headshots with AI
- 🎨 Customizable backgrounds (neutral, white, black, gray, office)
- 📐 Multiple aspect ratios (square, portrait, landscape)
- ⚙️ Optional gender specification for better results
- 🎲 Seed control for reproducible results
- 💾 Download generated headshots
- User signup/login (Supabase Auth)
- Credit system (Supabase DB)
- Purchase credits (Stripe integration ready)
- Dashboard/history

## Setup

1. **Clone the repo:**
   ```sh
   git clone https://github.com/yourusername/yourrepo.git
   cd yourrepo
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Create a `.env` file:**
   Copy `.env.example` to `.env` and fill in your secrets.

4. **Run locally:**
   ```sh
   node server_working1.js
   ```
   Or use `npm run dev` if you have a dev script.

## Environment Variables
See `.env.example` for all required variables.

## Deploying to Vercel
1. Push your code to GitHub.
2. Go to [vercel.com](https://vercel.com/) and import your repo.
3. Set all environment variables in the Vercel dashboard (from `.env.example`).
4. Deploy!

**Note:** If using Express backend, you may need to move your server code to `/api/server.js` for Vercel serverless functions, or deploy backend separately (e.g., Render) and use Vercel for frontend only.

## Stripe Integration (To Do)
- Add your Stripe keys to `.env` and Vercel.
- Implement Stripe Checkout on the frontend.
- Handle Stripe webhooks in `/api/stripe/webhook` to credit users after payment.

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
1. Copy `.env.example` to `.env`
2. Get your Replicate API token from https://replicate.com/account/api-tokens
3. Add your token to the `.env` file:
```
REPLICATE_API_TOKEN=r8_your_actual_token_here
```

### 3. Run the Application
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

### 4. Access the App
Open your browser and go to: http://localhost:3000

## API Endpoints

### POST /generate-headshot
Generate a professional headshot from an uploaded image.

**Parameters:**
- `image` (file): The input image file
- `gender` (string): Optional - "male", "female", or "none" (auto-detect)
- `background` (string): Background style - "neutral", "white", "black", "gray", "office"
- `aspectRatio` (string): Output ratio - "1:1", "4:3", "3:4", "16:9", "9:16"
- `seed` (number): Optional - for reproducible results

**Response:**
```json
{
  "success": true,
  "imageUrl": "https://...",
  "message": "Professional headshot generated successfully!"
}
```

### GET /health
Health check endpoint.

## Usage Tips

1. **Best Input Images:**
   - Clear, front-facing photos
   - Good lighting
   - Minimal background distractions
   - No sunglasses or hats

2. **Background Options:**
   - **Neutral**: Professional gray/beige tones
   - **White**: Clean white background
   - **Black**: Dramatic black background
   - **Gray**: Professional gray background
   - **Office**: Corporate office setting

3. **Aspect Ratios:**
   - **1:1 (Square)**: Perfect for social media profiles
   - **4:3 (Standard)**: Traditional headshot format
   - **3:4 (Portrait)**: Vertical orientation
   - **16:9 (Wide)**: Landscape format
   - **9:16 (Tall)**: Mobile-friendly vertical

## Technology Stack

- **Backend**: Node.js, Express.js
- **AI Model**: FLUX Kontext Professional Headshot (via Replicate)
- **File Upload**: Multer
- **Frontend**: Vanilla HTML/CSS/JavaScript

## Model Information

This app uses the `flux-kontext-apps/professional-headshot` model from Replicate, which is powered by FLUX.1 Kontext Pro. The model specializes in:

- Converting casual photos to professional headshots
- Maintaining facial identity while enhancing presentation
- Adjusting lighting, composition, and backgrounds
- Generating studio-quality results

## Security Notes

- API tokens are stored in environment variables
- Uploaded files are temporarily stored and automatically deleted
- File type validation prevents malicious uploads
- 10MB file size limit for uploads

## Troubleshooting

### Common Issues:

1. **"No API token" error**: Make sure your `.env` file contains a valid `REPLICATE_API_TOKEN`
2. **File upload fails**: Check file size (max 10MB) and format (JPG, PNG, WebP, GIF)
3. **Generation takes too long**: The AI model typically takes 10-30 seconds to process
4. **Poor results**: Try using clearer, front-facing photos with good lighting

### Error Codes:
- `400`: Bad request (missing image or invalid parameters)
- `500`: Server error (API issues or processing failures)

## License

This project is for educational and commercial use. The FLUX Kontext model can be used commercially according to Replicate's terms.

## Support

For issues related to:
- **App functionality**: Check the troubleshooting section above
- **Replicate API**: Visit https://replicate.com/docs
- **Model-specific questions**: Check https://replicate.com/flux-kontext-apps/professional-headshot
