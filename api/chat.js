export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ reply: 'Method not allowed' });

  try {
    const { message, image, imageMime, history = [], forceSearch } = req.body;

    if (!message &&!image) return res.status(400).json({ reply: 'No message provided.' });

    let finalReply = '';
    let modelUsed = 'JARVIS';
    let searchUsed = false;
    let searchQuery = null;

    // NEWS MODE - Using NewsAPI
    const isNewsQuery = /\b(today|news|headlines|latest|current)\b/i.test(message);

       if (isNewsQuery && process.env.NEWS_API_KEY) {
      searchUsed = true;
      searchQuery = message;
      modelUsed = 'NewsData.io';

      try {
        // NewsData.io API - nee key ki correct URL
        const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWS_API_KEY}&language=en&category=top&size=5`;
        const newsRes = await fetch(url);
        const newsData = await newsRes.json();

        if (newsData.status === 'success' && newsData.results?.length) {
          const newsList = newsData.results.map((article, index) =>
            `${index + 1}. ${article.title}\n   Source: ${article.source_id || 'News'}`
          ).join('\n\n');

          finalReply = `Here are today's top world headlines:\n\n${newsList}`;
        } else {
          finalReply = 'Could not fetch news. API response: ' + JSON.stringify(newsData);
        }
      } catch(e) {
        finalReply = 'News API error: ' + e.message;
      }

      return res.status(200).json({ reply: finalReply, model: modelUsed, searchUsed, searchQuery });
    }
        if (newsData.status === 'ok' && newsData.articles?.length) {
          const newsList = newsData.articles.map((article, index) =>
            `${index + 1}. ${article.title}\n Source: ${article.source.name}`
          ).join('\n\n');

          finalReply = `Here are today's top world headlines:\n\n${newsList}`;
        } else {
          finalReply = 'Could not fetch news. Please check NEWS_API_KEY.';
        }
      } catch(e) {
        finalReply = 'News API error: ' + e.message;
      }

      return res.status(200).json({ reply: finalReply, model: modelUsed, searchUsed, searchQuery });
    }

    // IMAGE MODE
    if (image && process.env.GEMINI_API_KEY) {
      modelUsed = 'GEMINI 1.5 FLASH';
      const gRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: `You are JARVIS. Analyze this image and answer: ${message || 'Describe this image in detail'}` },
                { inline_data: { mime_type: imageMime || 'image/jpeg', data: image } }
              ]
            }]
          })
        }
      );
      const gData = await gRes.json();
      finalReply = gData.candidates?.[0]?.content?.parts?.[0]?.text || 'Image analysis failed.';
      return res.status(200).json({ reply: finalReply, model: modelUsed });
    }

    // SEARCH MODE - Using Tavily
    const needsSearch = forceSearch || /\b(price|weather|score|winner|trending)\b/i.test(message);

    if (needsSearch && process.env.TAVILY_API_KEY) {
      searchUsed = true;
      searchQuery = message;
      let context = '';

      try {
        const tvRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: message,
            search_depth: 'basic',
            max_results: 5
          })
        });
        const tvData = await tvRes.json();
        if (tvData.results?.length) {
          context = tvData.results.map(r => `${r.title}: ${r.content}`).join('\n\n');
        }
      } catch(e) { console.log('Tavily error:', e.message); }

      if (process.env.GROQ_API_KEY) {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: `You are JARVIS. Web search results: ${context}. Answer based on this.` },
              { role: 'user', content: message }
            ],
            temperature: 0.5, max_tokens: 800
          })
        });
        const groqData = await groqRes.json();
        finalReply = groqData.choices?.[0]?.message?.content || 'No answer found.';
        modelUsed = 'GROQ + TAVILY';
      }
    } else if (process.env.GROQ_API_KEY) {
      // NORMAL CHAT MODE
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are JARVIS, a professional AI assistant. Be helpful, clear, concise. Reply in Telugu if user writes Telugu.' },
           ...history.slice(-8),
            { role: 'user', content: message }
          ],
          temperature: 0.7, max_tokens: 600
        })
      });
      const groqData = await groqRes.json();
      finalReply = groqData.choices?.[0]?.message?.content || 'No response generated.';
      modelUsed = 'GROQ LLAMA-3.3-70B';
    } else {
      finalReply = `You said: "${message}". Add GROQ_API_KEY to Vercel for AI replies, or ask "today news" for headlines!`;
    }

    return res.status(200).json({ reply: finalReply, model: modelUsed, searchUsed, searchQuery });

  } catch(error) {
    console.error('JARVIS Error:', error);
    return res.status(500).json({ reply: 'Server error: ' + error.message });
  }
}
