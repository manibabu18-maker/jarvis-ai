export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Method not allowed' });
  }

  // GOOGLE LOGIN CHECK - Security kosam
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ 
      reply: '⚠️ Please sign in with Google to access JARVIS.' 
    });
  }

  // Verify Supabase token
  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });
    
    if (!verifyRes.ok) {
      return res.status(401).json({ reply: 'Session expired. Please sign in again.' });
    }
  } catch (e) {
    return res.status(401).json({ reply: 'Auth verification failed: ' + e.message });
  }

  // MAIN LOGIC
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: 'No message provided.' });
    }

    // Check if user asking for news
    const isNewsQuery = /\b(news|headlines|latest|today|current|breaking|world|india|ai)\b/i.test(message);

    if (isNewsQuery) {
      // NEWS_API_KEY check
      if (!process.env.NEWS_API_KEY) {
        return res.status(200).json({ 
          reply: 'NEWS_API_KEY not configured. Admin, please add it in Vercel Environment Variables.',
          model: 'JARVIS'
        });
      }

      try {
        // NewsData.io /latest endpoint
        const url = `https://newsdata.io/api/1/latest?apikey=${process.env.NEWS_API_KEY}&language=en&size=5`;
        const newsRes = await fetch(url);
        
        if (!newsRes.ok) {
          throw new Error(`News API returned ${newsRes.status}`);
        }

        const newsData = await newsRes.json();

        if (newsData.status === 'success' && newsData.results?.length > 0) {
          const newsList = newsData.results.slice(0, 5).map((article, index) =>
            `${index + 1}. ${article.title}\n   Source: ${article.source_id || article.source_name || 'News'}`
          ).join('\n\n');

          return res.status(200).json({ 
            reply: `Here are today's top world headlines:\n\n${newsList}`,
            model: 'NewsData.io',
            searchUsed: true
          });
        } else if (newsData.status === 'error') {
          return res.status(200).json({ 
            reply: `News API Error: ${newsData.results?.message || 'Check your API key or quota'}`,
            model: 'NewsData.io'
          });
        } else {
          return res.status(200).json({ 
            reply: 'No news found right now. Try again in a few minutes.',
            model: 'NewsData.io'
          });
        }

      } catch (newsError) {
        console.error('News fetch error:', newsError);
        return res.status(200).json({ 
          reply: `Failed to fetch news: ${newsError.message}. Check NEWS_API_KEY in Vercel.`,
          model: 'JARVIS'
        });
      }
    }

    // Normal chat reply
    return res.status(200).json({ 
      reply: `Hello! I'm JARVIS. Ask me "today news" for latest headlines from around the world.`,
      model: 'JARVIS'
    });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ 
      reply: 'Server error occurred. Please try again.',
      error: error.message 
    });
  }
}
