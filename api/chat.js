export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ reply: 'Method not allowed' });

  // Auth check
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ reply: 'Unauthorized. Please sign in.' });

  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });
    if (!verifyRes.ok) return res.status(401).json({ reply: 'Session expired. Please sign in again.' });
  } catch(e) {
    return res.status(401).json({ reply: 'Auth error: ' + e.message });
  }

  try {
    const { message, image, imageMime, history = [], forceSearch } = req.body;

    if (!message && !image) return res.status(400).json({ reply: 'No message provided.' });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ reply: 'GROQ API key missing.' });

    let finalReply = '';
    let modelUsed = 'GROQ LLAMA-3.3-70B';
    let searchUsed = false;
    let searchQuery = null;

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
                { text: `You are JARVIS, a professional AI assistant. Analyze this image and answer: ${message || 'Describe this image in detail'}` },
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

    // SEARCH MODE
    const needsSearch = forceSearch || /\b(today|news|latest|current|price|weather|score|winner|trending)\b/i.test(message);

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

      if (process.env.GEMINI_API_KEY && context) {
        modelUsed = 'GROQ + TAVILY + GEMINI';
        try {
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `You are JARVIS. User asked: "${message}"\n\nWeb results:\n${context}\n\nGive clear professional answer. Use bullet points. Reply in Telugu if user wrote Telugu.`
                  }]
                }]
              })
            }
          );
          const gData = await gRes.json();
          finalReply = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch(e) { console.log('Gemini error:', e.message); }
      }

      if (!finalReply) {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: `You are JARVIS. Search context: ${context}` },
              { role: 'user', content: message }
            ],
            temperature: 0.5, max_tokens: 800
          })
        });
        const groqData = await groqRes.json();
        finalReply = groqData.choices?.[0]?.message?.content || 'No answer found.';
        modelUsed = 'GROQ + TAVILY';
      }

    } else {
      // CHAT MODE
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
    }

    return res.status(200).json({ reply: finalReply, model: modelUsed, searchUsed, searchQuery });

  } catch(error) {
    console.error('JARVIS Error:', error);
    return res.status(500).json({ reply: 'Server error: ' + error.message });
  }
}
