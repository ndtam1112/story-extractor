import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import path from 'path';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from "@google/genai";

const app = express();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const modelId = "gemini-3-flash-preview";

app.use(express.json());
app.use(cookieParser());

async function cleanTextWithAI(text: string): Promise<string> {
  try {
    const prompt = `You are a story text cleaner. Your task is to remove all advertisements, promotional content, and non-story text from the following Vietnamese story content.
    
Rules:
1. If you see the sentence "MỞ ỨNG DỤNG SHOPEE để mở khóa toàn bộ chương truyện!", remove it and EVERYTHING that follows it.
2. Remove any sentences or paragraphs that mention "Shopee" or "TikTok".
3. If a paragraph contains "Shopee" or "TikTok", remove that paragraph AND the paragraph immediately following it.
4. Return ONLY the cleaned story text. Do not add any introduction or conclusion.
5. Keep the original formatting (paragraphs separated by newlines).

Story Content:
${text}`;

    const result = await genAI.models.generateContent({ 
      model: modelId, 
      contents: prompt 
    });
    return result.text || text;
  } catch (error) {
    console.error('AI Cleanup error:', error);
    return text; // Fallback to original text if AI fails
  }
}

// Helper function to extract story content
async function extractStory(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  let pageTitle = $('title').text().trim() || 'Extracted Story';
  let storyTitle = '';
  let chapterTitle = '';

  // Strategy 1: Parse from <title> tag (e.g., "Chương 2: Tên Chương - Tên Truyện - Site")
  if (pageTitle.includes('-')) {
    const parts = pageTitle.split('-').map(p => p.trim());
    chapterTitle = parts[0]; // "Chương 2: Tên Chương"
    if (parts.length > 1) {
      storyTitle = parts[1]; // "Tên Truyện"
    }
  } else {
    chapterTitle = pageTitle;
  }

  // Strategy 2: Look for specific elements if Strategy 1 was incomplete
  if (!storyTitle) {
    // Try breadcrumbs or specific links
    storyTitle = $('.breadcrumb li:nth-child(2) a, a[href*="/truyen/"], .truyen-title').first().text().trim();
  }

  // Clean up chapterTitle: remove everything after the dash if it was still there
  if (chapterTitle.includes('-')) {
    chapterTitle = chapterTitle.split('-')[0].trim();
  }

  let content = '';
  
  const container = $('.reading-content, .chapter-c, .story-detail-content, #chapter-c, .box-chap, .content-story');

  if (container.length > 0) {
    container.find('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        content += text + '\n\n';
      }
    });
    
    if (!content) {
      content = container.text().trim().replace(/\n\s*\n/g, '\n\n');
    }
  } else {
    $('body p').each((i, el) => {
      const text = $(el).text().trim();
      if (text) {
        content += text + '\n\n';
      }
    });
  }

  // Manual cleanup first for speed and reliability
  content = content.replace(/Mời bạn CLICK vào liên kết bên dưới và.*/gi, '');
  
  // Truncate at the Shopee app unlock message
  const shopeeUnlockMsg = "MỞ ỨNG DỤNG SHOPEE để mở khóa toàn bộ chương truyện!";
  if (content.includes(shopeeUnlockMsg)) {
    content = content.split(shopeeUnlockMsg)[0].trim();
  }

  // Paragraph-based cleanup for Shopee/TikTok
  let paragraphs = content.split('\n\n');
  let cleanedParagraphs = [];
  let skipNext = false;

  for (let i = 0; i < paragraphs.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const p = paragraphs[i];
    const lowerP = p.toLowerCase();
    
    if (lowerP.includes('shopee') || lowerP.includes('tiktok')) {
      skipNext = true;
      continue;
    }

    cleanedParagraphs.push(p);
  }
  content = cleanedParagraphs.join('\n\n');

  // Final AI Polish to catch tricky ads
  content = await cleanTextWithAI(content);

  return { 
    title: chapterTitle, // Keep 'title' for backward compatibility
    storyTitle: storyTitle || 'Unknown Story',
    chapterTitle: chapterTitle,
    text: content.trim() 
  };
}

// API endpoint for n8n and other external integrations
app.all('/api/extract', async (req, res) => {
  try {
    const url = req.query.url || req.body.url;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required. Send as ?url=... or {"url": "..."}' });
    }

    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedApiKey = process.env.API_KEY;
    
    if (expectedApiKey && apiKey !== expectedApiKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    const result = await extractStory(url);
    res.json(result);
  } catch (error: any) {
    console.error('API Extract error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract content' });
  }
});

app.post('/api/fetch-story', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await extractStory(url);
    res.json(result);
  } catch (error: any) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch and parse the URL' });
  }
});

app.get('/api/auth/url', (req, res) => {
  const redirectUri = req.query.redirectUri as string;
  if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured in environment variables.' });
  }
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    redirectUri
  );
  
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/spreadsheets'],
    prompt: 'consent',
    state: redirectUri
  });
  
  res.json({ url });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = state as string;
  
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      redirectUri
    );
    
    const { tokens } = await oauth2Client.getToken(code as string);
    
    res.cookie('google_tokens', JSON.stringify(tokens), {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({ isAuthenticated: !!req.cookies.google_tokens });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('google_tokens', { secure: true, sameSite: 'none', httpOnly: true });
  res.json({ success: true });
});

app.post('/api/export-to-sheets', async (req, res) => {
  try {
    const tokensStr = req.cookies.google_tokens;
    if (!tokensStr) {
      return res.status(401).json({ error: 'Not authenticated with Google' });
    }

    const { title, text, storyTitle } = req.body;
    if (!title || !text) {
      return res.status(400).json({ error: 'Title and text are required' });
    }

    const tokens = JSON.parse(tokensStr);
    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );
    oauth2Client.setCredentials(tokens);

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Extracted: ${storyTitle ? storyTitle + ' - ' : ''}${title.substring(0, 50)}`
        }
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const sheetUrl = spreadsheet.data.spreadsheetUrl;

    const paragraphs = text.split('\n\n').filter((p: string) => p.trim());
    const values = [
      [storyTitle || ''],
      [title],
      [''], // Empty row for spacing
      ...paragraphs.map((p: string) => [p])
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: { values }
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.1, green: 0.1, blue: 0.4 } },
                  wrapStrategy: 'WRAP',
                  verticalAlignment: 'MIDDLE'
                }
              },
              fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 1,
                endRowIndex: 2,
                startColumnIndex: 0,
                endColumnIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 14, foregroundColor: { red: 0.3, green: 0.3, blue: 0.3 } },
                  wrapStrategy: 'WRAP',
                  verticalAlignment: 'MIDDLE'
                }
              },
              fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 3,
                endRowIndex: paragraphs.length + 3,
                startColumnIndex: 0,
                endColumnIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  textFormat: { fontSize: 11, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } },
                  verticalAlignment: 'TOP'
                }
              },
              fields: 'userEnteredFormat(wrapStrategy,textFormat,verticalAlignment)'
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 1
              },
              properties: {
                pixelSize: 800
              },
              fields: 'pixelSize'
            }
          }
        ]
      }
    });

    res.json({ url: sheetUrl });
  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message || 'Failed to export to Google Sheets' });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export { app };
