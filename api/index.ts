import 'dotenv/config';
import express from 'express';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from "@google/genai";

const app = express();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const modelId = "gemini-3-flash-preview";

app.use(express.json());
app.use(cookieParser());

// Basic health check for Vercel debugging
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    nodeVersion: process.version,
    env: process.env.NODE_ENV
  });
});

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
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  let pageTitle = $('title').text().trim() || 'Extracted Story';
  let storyTitle = $('.truyen-title, .breadcrumb li:nth-child(2) a, a[href*="/truyen/"], #truyen-title').first().text().trim();
  let chapterTitle = $('.chapter-title, h1.chapter-title, .title-chapter, h1').first().text().trim();

  // Strategy 1: Parse from <title> tag if titles are missing
  if (!storyTitle || !chapterTitle) {
    if (pageTitle.includes('-')) {
      const parts = pageTitle.split('-').map(p => p.trim());
      if (!chapterTitle) chapterTitle = parts[0];
      if (!storyTitle && parts.length > 1) {
        storyTitle = parts[1];
      }
    }
  }

  // Clean up chapterTitle
  if (chapterTitle && chapterTitle.includes('-')) {
    chapterTitle = chapterTitle.split('-')[0].trim();
  }

  let content = '';
  
  // Try known containers first
  const container = $('.reading-content, .chapter-c, .story-detail-content, #chapter-c, .box-chap, .content-story, .chapter-content, #chapter-content');

  const processElement = (el: any) => {
    let text = '';
    // Handle fragmented text from sites like vivutruyen2.net
    if ($(el).find('.goog-rentry, .google-anno-skip').length > 0) {
      $(el).find('.goog-rentry, .google-anno-skip').each((_, skip) => {
        text += $(skip).text() + ' ';
      });
    } else {
      text = $(el).text();
    }
    return text.trim();
  };

  if (container.length > 0) {
    container.find('p, div.goog-rentry, .google-anno-skip').each((i, el) => {
      const text = processElement(el);
      if (text) {
        content += text + '\n\n';
      }
    });
    
    if (!content) {
      content = container.text().trim().replace(/\n\s*\n/g, '\n\n');
    }
  } else {
    // Fallback: search for all paragraphs or goog-rentry divs that likely contain story text
    $('p, div.goog-rentry, .google-anno-skip').each((i, el) => {
      const text = processElement(el);
      // Heuristic: ignore short texts or nav-like texts
      if (text && text.length > 20) {
        content += text + '\n\n';
      }
    });
  }

  // Manual cleanup for known ads
  content = content.replace(/Mời bạn CLICK vào liên kết bên dưới và.*/gi, '');
  content = content.replace(/Mời bạn ủng hộ.*/gi, '');
  
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
    
    // Improved detection for ad
    if (lowerP.includes('shopee') || lowerP.includes('tiktok') || lowerP.includes('khám phá thêm')) {
      skipNext = true;
      continue;
    }

    cleanedParagraphs.push(p);
  }
  content = cleanedParagraphs.join('\n\n');

  // Final AI Polish
  if (content.trim()) {
    content = await cleanTextWithAI(content);
  }

  return { 
    title: chapterTitle || pageTitle, 
    storyTitle: storyTitle || 'Unknown Story',
    chapterTitle: chapterTitle || 'Unknown Chapter',
    text: content.trim() || 'Warning: No content could be extracted from this page.'
  };
}

// Helper function to extract chapter list from a story page
async function extractChapters(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const storyTitle = $('.truyen-title, .breadcrumb li:nth-child(2) a, a[href*="/truyen/"], #truyen-title, h1').first().text().trim() || 'Unknown Story';
  
  const chapters: { title: string; url: string }[] = [];
  
  // Primary selector: .uk-switcher > li.uk-active .list .chap-title
  // Combined with fallback: .chap-title inside active switcher
  const activeSwitcher = $('.uk-switcher > li.uk-active');
  let chapterElements = activeSwitcher.find('.list .chap-title');
  
  if (chapterElements.length === 0) {
    // Fallback search anywhere in active switcher
    chapterElements = activeSwitcher.find('.chap-title');
  }

  if (chapterElements.length === 0) {
    // Broader fallback for other sites
    chapterElements = $('.chap-title, .chapter-list a, .list-chapter a, a[href*="/chuong-"], a[href*="/chapter-"]');
  }

  const baseUrl = new URL(url).origin;

  chapterElements.each((_, el) => {
    let title = $(el).text().trim();
    // Remove "Bắt Đầu Đọc" or similar buttons if they exist inside the selector
    title = title.replace(/Bắt Đầu Đọc/gi, '').trim();
    
    // Remove story name from chapter title if it exists
    if (storyTitle && title.toLowerCase().includes(storyTitle.toLowerCase())) {
      const regex = new RegExp(storyTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      title = title.replace(regex, '').trim();
    }

    // Further cleanup: if it starts with "Chương X", try to keep only that part if followed by redundant info
    const match = title.match(/^(Chương\s+\d+)/i);
    if (match) {
      // If the user wants ONLY "Chương X", we could restrict it here. 
      // But let's be safe and just remove the story title for now as requested.
      // Wait, user said "chỉ cần lấy Chương 1, không cần tên truyện". 
      // This implies if it's "Chương 1: ABC", maybe they want "Chương 1"? 
      // Actually, "Chương 1 Chồng Tôi Phải Lòng Bạn Thân Tôi" -> "Chương 1".
      // Let's use the match to be more precise if it exists.
      title = match[0];
    }
    
    let href = $(el).attr('href') || $(el).closest('a').attr('href');
    
    if (title && href) {
      if (href.startsWith('/')) {
        href = baseUrl + href;
      }
      chapters.push({ title, url: href });
    }
  });

  return {
    storyTitle,
    chapters: chapters.filter((c, i, self) => 
      i === self.findIndex((t) => (t.url === c.url))
    ).sort((a, b) => {
      // Natural sort by chapter number
      const aNum = parseInt(a.title.match(/\d+/)?.[0] || '0');
      const bNum = parseInt(b.title.match(/\d+/)?.[0] || '0');
      if (aNum !== bNum) return aNum - bNum;
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    }).map(c => ({
      ...c,
      // Ensure we don't have duplicate titles if titles are same but URLs different (unlikely but safe)
    }))
  };
}

// API endpoint for n8n and other external integrations
app.all('/api/extract', async (req, res) => {
  try {
    const url = req.query.url || req.body.url;
    console.log(`[API] Extracting: ${url}`);
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required. Send as ?url=... or {"url": "..."}' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'GEMINI_API_KEY is not configured.',
        context: 'Please set the GEMINI_API_KEY environment variable in your Vercel Dashboard Settings.'
      });
    }

    const result = await extractStory(url);
    res.json(result);
  } catch (error: any) {
    console.error('[API] Extract error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal Server Error',
      details: error.stack?.split('\n')[0], // Basic diagnostic
      context: 'Check your Vercel Environment Variables and ensure GEMINI_API_KEY is set.'
    });
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

app.post('/api/fetch-chapters', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await extractChapters(url);
    res.json(result);
  } catch (error: any) {
    console.error('Fetch chapters error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch chapters' });
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

export default app;
